"""my_label_tool prelabel protocol example using only Python's standard library."""

import json
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


def send(message):
    with _write_lock:
        sys.stdout.write(json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n")
        sys.stdout.flush()


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


def run_prelabel(request_id, params, cancelled):
    try:
        progress(request_id, 0, "开始示例预打标")
        for step in range(1, 5):
            if cancelled.wait(0.05):
                respond_error(request_id, "CANCELLED", "示例预打标已取消")
                return
            progress(request_id, step * 25, f"示例步骤 {step}/4")
        respond_result(
            request_id,
            {
                "annotations": [],
                "imageId": params.get("imageId") if isinstance(params, dict) else None,
            },
        )
    except Exception as error:  # The protocol boundary must always return a typed error.
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
        else:
            handle_control(message)


if __name__ == "__main__":
    main()
