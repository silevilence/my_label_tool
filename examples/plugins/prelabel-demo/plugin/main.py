"""my_label_tool prelabel protocol example using only Python's standard library."""

import base64
import json
import queue
import sys
import threading
import time


PROTOCOL_VERSION = 1
HOST_API_VERSION = 1
PRELABEL_API_VERSION = 1
MAX_NDJSON_LINE_BYTES = 16 * 1024 * 1024
_write_lock = threading.Lock()
_jobs_lock = threading.Lock()
_jobs = {}
_proxy_lock = threading.Lock()
_proxy_sequence = 0
_proxy_responses = {}


def send(message):
    encoded = json.dumps(message, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) > MAX_NDJSON_LINE_BYTES:
        raise ValueError("协议消息超过 16 MiB 上限")
    with _write_lock:
        sys.stdout.buffer.write(encoded + b"\n")
        sys.stdout.buffer.flush()


def respond_result(request_id, result):
    send({"v": PROTOCOL_VERSION, "id": request_id, "type": "response", "result": result})


def respond_error(request_id, code, message):
    send(
        {
            "v": PROTOCOL_VERSION,
            "id": request_id,
            "type": "response",
            "error": {"code": code, "message": message},
        }
    )


def progress(request_id, percent, message):
    send(
        {
            "v": PROTOCOL_VERSION,
            "id": request_id,
            "type": "event",
            "event": "progress",
            "payload": {"percent": percent, "message": message},
        }
    )


def read_project_image(relative_path, cancelled):
    global _proxy_sequence
    with _proxy_lock:
        _proxy_sequence += 1
        proxy_id = f"fs-read-{_proxy_sequence}"
        response_queue = queue.Queue(maxsize=1)
        _proxy_responses[proxy_id] = response_queue
    send(
        {
            "v": PROTOCOL_VERSION,
            "id": proxy_id,
            "type": "request",
            "method": "fs.read",
            "params": {"path": relative_path, "encoding": "base64"},
        }
    )
    try:
        while not cancelled.is_set():
            try:
                response = response_queue.get(timeout=0.05)
                break
            except queue.Empty:
                continue
        else:
            raise RuntimeError("cancelled")
        if "error" in response:
            error = response["error"]
            raise RuntimeError(f"{error.get('code')}: {error.get('message')}")
        encoded = response.get("result", {}).get("contentBase64")
        if not isinstance(encoded, str):
            raise RuntimeError("fs.read 未返回 Base64 内容")
        return base64.b64decode(encoded, validate=True)
    finally:
        with _proxy_lock:
            _proxy_responses.pop(proxy_id, None)


def run_prelabel(request_id, params, cancelled):
    shapes = []
    completed_image_paths = []
    try:
        image_paths = params.get("imagePaths") if isinstance(params, dict) else None
        mappings = params.get("classMappings") if isinstance(params, dict) else None
        if not isinstance(image_paths, list) or not image_paths or not isinstance(mappings, list):
            respond_error(request_id, "INVALID_ARGUMENT", "imagePaths 与 classMappings 无效")
            return
        mapping = next(
            (
                candidate
                for candidate in mappings
                if isinstance(candidate, dict)
                and candidate.get("modelClass") == "example-object"
                and isinstance(candidate.get("labelId"), str)
            ),
            None,
        )
        for index, image_path in enumerate(image_paths):
            if cancelled.is_set():
                break
            if not isinstance(image_path, str):
                respond_error(request_id, "INVALID_ARGUMENT", "图片路径必须是字符串")
                return
            image_bytes = read_project_image(image_path, cancelled)
            if not image_bytes:
                respond_error(request_id, "INVALID_ARGUMENT", "图片文件为空")
                return
            if mapping is not None:
                shapes.append(
                    {
                        "imagePath": image_path,
                        "id": f"example-{index}",
                        "type": "rect",
                        "labelId": mapping["labelId"],
                        "points": [1, 1, 16, 16],
                        "attributes": {"confidence": 0.9},
                        "frameIndex": 0,
                    }
                )
            progress(
                request_id,
                ((index + 1) / len(image_paths)) * 100,
                f"已处理 {index + 1}/{len(image_paths)} 张图片",
            )
            completed_image_paths.append(image_path)
        respond_result(
            request_id,
            {
                "shapes": shapes,
                "cancelled": cancelled.is_set(),
                "completedImagePaths": completed_image_paths if cancelled.is_set() else [],
            },
        )
    except Exception as error:  # The protocol boundary must always return a typed error.
        if cancelled.is_set():
            respond_result(
                request_id,
                {
                    "shapes": shapes,
                    "cancelled": True,
                    "completedImagePaths": completed_image_paths,
                },
            )
        else:
            respond_error(request_id, "INTERNAL_ERROR", str(error))
    finally:
        with _jobs_lock:
            _jobs.pop(request_id, None)


def handle_request(message):
    request_id = message["id"]
    method = message.get("method")
    params = message.get("params")
    if method == "hello":
        versions = params.get("supportedVersions") if isinstance(params, dict) else None
        supported = (
            isinstance(versions, dict)
            and HOST_API_VERSION in versions.get("hostApi", [])
            and PRELABEL_API_VERSION in versions.get("prelabel", [])
        )
        if (
            not isinstance(params, dict)
            or params.get("protocolVersion") != PROTOCOL_VERSION
            or params.get("hostApiVersion") != HOST_API_VERSION
            or not supported
        ):
            respond_error(request_id, "API_VERSION_UNSUPPORTED", "仅支持协议、宿主 API 与预打标 API v1")
            return
        respond_result(
            request_id,
            {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {
                    "prelabel": True,
                    "batch": True,
                    "progress": True,
                    "cancel": True,
                },
            },
        )
        return
    if method == "prelabel.run":
        cancelled = threading.Event()
        with _jobs_lock:
            _jobs[request_id] = cancelled
        threading.Thread(
            target=run_prelabel,
            args=(request_id, params, cancelled),
            daemon=True,
        ).start()
        return
    respond_error(request_id, "METHOD_NOT_FOUND", f"未知方法：{method}")


def handle_control(message):
    if message.get("action") == "heartbeat":
        send({"v": PROTOCOL_VERSION, "id": message.get("id"), "type": "control", "action": "heartbeat"})
        return
    if message.get("action") == "cancel":
        with _jobs_lock:
            cancelled = _jobs.get(message.get("id"))
        if cancelled is not None:
            cancelled.set()


def handle_response(message):
    with _proxy_lock:
        response_queue = _proxy_responses.get(message.get("id"))
    if response_queue is not None:
        response_queue.put(message)


def read_protocol_line():
    raw = sys.stdin.buffer.readline(MAX_NDJSON_LINE_BYTES + 2)
    if not raw:
        return "eof", None
    terminated = raw.endswith(b"\n")
    if not terminated and len(raw) == MAX_NDJSON_LINE_BYTES + 2:
        while True:
            remainder = sys.stdin.buffer.readline(8192)
            if not remainder or remainder.endswith(b"\n"):
                break
        return "too-long", None
    if terminated:
        raw = raw[:-1]
        if raw.endswith(b"\r"):
            raw = raw[:-1]
    if len(raw) > MAX_NDJSON_LINE_BYTES:
        return "too-long", None
    return "line", raw


def decode_host_message(raw):
    try:
        message = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        respond_error("parse-error", "PARSE_ERROR", str(error))
        return None
    if not isinstance(message, dict):
        respond_error("protocol-error", "PROTOCOL_ERROR", "协议消息必须是 JSON 对象")
        return None
    message_id = message.get("id")
    message_type = message.get("type")
    valid_id = isinstance(message_id, str) and bool(message_id)
    if message.get("v") != PROTOCOL_VERSION or "id" not in message:
        respond_error(valid_id and message_id or "protocol-error", "PROTOCOL_ERROR", "协议信封无效")
        return None
    if message_type == "request":
        if (
            not valid_id
            or not isinstance(message.get("method"), str)
            or not message.get("method")
            or "params" not in message
        ):
            respond_error(valid_id and message_id or "protocol-error", "PROTOCOL_ERROR", "请求形状无效")
            return None
    elif message_type == "control":
        action = message.get("action")
        heartbeat_id = message_id is None or valid_id
        if action == "cancel" and not valid_id:
            respond_error("protocol-error", "PROTOCOL_ERROR", "取消消息缺少调用 id")
            return None
        if action == "heartbeat" and not heartbeat_id:
            respond_error("protocol-error", "PROTOCOL_ERROR", "心跳 id 无效")
            return None
        if action not in ("cancel", "heartbeat"):
            respond_error(valid_id and message_id or "protocol-error", "PROTOCOL_ERROR", "控制动作无效")
            return None
    elif message_type == "response":
        if not valid_id or (("result" in message) == ("error" in message)):
            respond_error(valid_id and message_id or "protocol-error", "PROTOCOL_ERROR", "响应形状无效")
            return None
    else:
        respond_error(valid_id and message_id or "protocol-error", "PROTOCOL_ERROR", "消息类型无效")
        return None
    return message


def main():
    while True:
        state, raw = read_protocol_line()
        if state == "eof":
            return
        if state == "too-long":
            respond_error("protocol-error", "PROTOCOL_ERROR", "协议单行超过 16 MiB")
            continue
        message = decode_host_message(raw)
        if message is None:
            continue
        if message["type"] == "request":
            handle_request(message)
        elif message["type"] == "control":
            handle_control(message)
        else:
            handle_response(message)


if __name__ == "__main__":
    main()
