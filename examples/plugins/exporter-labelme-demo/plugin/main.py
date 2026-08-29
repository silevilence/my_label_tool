"""LabelMe exporter example for the my_label_tool NDJSON plugin protocol."""

import json
import pathlib
import sys
import threading
import time


PROTOCOL_VERSION = 1
HOST_API_VERSION = 1
EXPORTER_API_VERSION = 1
MAX_NDJSON_LINE_BYTES = 72 * 1024 * 1024
_write_lock = threading.Lock()
_jobs_lock = threading.Lock()
_jobs = {}


def send(message):
    with _write_lock:
        sys.stdout.write(json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n")
        sys.stdout.flush()


def respond_result(request_id, result):
    send({"v": 1, "id": request_id, "type": "response", "result": result})


def respond_error(request_id, code, message):
    send(
        {
            "v": 1,
            "id": request_id,
            "type": "response",
            "error": {"code": code, "message": message},
        }
    )


def progress(request_id, percent, message):
    send(
        {
            "v": 1,
            "id": request_id,
            "type": "event",
            "event": "progress",
            "payload": {"percent": percent, "message": message},
        }
    )


def label_name(labels, label_id):
    for label in labels:
        if label.get("id") == label_id:
            return label.get("name", label_id)
    return label_id


def labelme_shape(annotation, labels):
    points = annotation.get("points", [])
    shape_type = annotation.get("type")
    if shape_type == "rect" and len(points) == 4:
        x, y, width, height = points
        converted_points = [[x, y], [x + width, y + height]]
        labelme_type = "rectangle"
    elif shape_type == "polygon" and len(points) >= 6 and len(points) % 2 == 0:
        converted_points = [points[index : index + 2] for index in range(0, len(points), 2)]
        labelme_type = "polygon"
    elif shape_type == "point" and len(points) == 2:
        converted_points = [points]
        labelme_type = "point"
    else:
        raise ValueError(f"无效标注坐标：{annotation.get('id', '<unknown>')}")
    return {
        "label": label_name(labels, annotation.get("labelId")),
        "points": converted_points,
        "group_id": None,
        "description": "",
        "shape_type": labelme_type,
        "flags": {},
        "attributes": annotation.get("attributes", {}),
    }


def run_export(request_id, params, cancelled):
    try:
        if not isinstance(params, dict) or params.get("formatId") != "labelme":
            respond_error(request_id, "INVALID_ARGUMENT", "只支持 labelme 格式")
            return
        export_data = params.get("exportData")
        options = params.get("options")
        if not isinstance(export_data, dict) or not isinstance(options, dict):
            respond_error(request_id, "INVALID_ARGUMENT", "exportData/options 形状无效")
            return
        labels = export_data.get("labels")
        images = export_data.get("images")
        if not isinstance(labels, list) or not isinstance(images, list):
            respond_error(request_id, "INVALID_ARGUMENT", "labels/images 必须是数组")
            return
        delay_seconds = max(0, min(float(options.get("delayMs", 0)) / 1000, 1))
        files = []
        total = max(len(images), 1)
        for index, image in enumerate(images):
            if cancelled.wait(delay_seconds):
                respond_error(request_id, "CANCELLED", "LabelMe 导出已取消")
                return
            if not isinstance(image, dict):
                raise ValueError("图片项必须是对象")
            image_path = image.get("path")
            if not isinstance(image_path, str) or pathlib.PurePath(image_path).is_absolute():
                raise ValueError("图片路径必须是项目相对路径")
            document = {
                "version": "5.5.0",
                "flags": {},
                "shapes": [
                    labelme_shape(annotation, labels)
                    for annotation in image.get("annotations", [])
                ],
                "imagePath": image_path.replace("\\", "/"),
                "imageData": None,
                "imageHeight": image.get("height"),
                "imageWidth": image.get("width"),
            }
            output_name = f"{pathlib.PurePath(image.get('name', image_path)).stem}.json"
            files.append(
                {
                    "relativePath": output_name,
                    "contentUtf8": json.dumps(document, ensure_ascii=False, indent=2),
                }
            )
            progress(request_id, (index + 1) * 100 / total, f"已转换 {index + 1}/{len(images)}")
        if not files:
            files.append(
                {
                    "relativePath": f"{params.get('outputBaseName', 'annotations')}.json",
                    "contentUtf8": json.dumps(
                        {"version": "5.5.0", "flags": {}, "shapes": []},
                        ensure_ascii=False,
                        indent=2,
                    ),
                }
            )
        respond_result(request_id, {"files": files})
    except (TypeError, ValueError) as error:
        respond_error(request_id, "INVALID_ARGUMENT", str(error))
    except Exception as error:  # Protocol boundary must always return a typed error.
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
            and EXPORTER_API_VERSION in versions.get("exporter", [])
        )
        if (
            not isinstance(params, dict)
            or params.get("protocolVersion") != PROTOCOL_VERSION
            or params.get("hostApiVersion") != HOST_API_VERSION
            or not supported
        ):
            respond_error(request_id, "API_VERSION_UNSUPPORTED", "仅支持协议、宿主与 exporter API v1")
            return
        respond_result(
            request_id,
            {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {"exporter": True, "progress": True, "cancel": True},
            },
        )
        return
    if method == "exporter.export":
        cancelled = threading.Event()
        with _jobs_lock:
            _jobs[request_id] = cancelled
        threading.Thread(
            target=run_export,
            args=(request_id, params, cancelled),
        ).start()
        return
    respond_error(request_id, "METHOD_NOT_FOUND", f"未知方法：{method}")


def handle_control(message):
    if message.get("action") == "heartbeat":
        send({"v": 1, "id": message.get("id"), "type": "control", "action": "heartbeat"})
    elif message.get("action") == "cancel":
        with _jobs_lock:
            job = _jobs.get(message.get("id"))
        if job is not None:
            job.set()


def read_protocol_line(stream=None, max_line_bytes=MAX_NDJSON_LINE_BYTES):
    stream = stream or sys.stdin.buffer
    raw = stream.readline(max_line_bytes + 2)
    if not raw:
        return "eof", None
    terminated = raw.endswith(b"\n")
    if not terminated and len(raw) == max_line_bytes + 2:
        while True:
            remainder = stream.readline(8192)
            if not remainder or remainder.endswith(b"\n"):
                break
        return "too-long", None
    if terminated:
        raw = raw[:-1]
        if raw.endswith(b"\r"):
            raw = raw[:-1]
    if len(raw) > max_line_bytes:
        return "too-long", None
    return "line", raw


def main():
    while True:
        status, raw = read_protocol_line()
        if status == "eof":
            return
        if status == "too-long":
            respond_error("protocol-error", "PROTOCOL_ERROR", "协议单行超过 72 MiB")
            continue
        assert raw is not None
        try:
            message = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            respond_error("parse-error", "PARSE_ERROR", str(error))
            continue
        if not isinstance(message, dict) or message.get("v") != 1:
            respond_error("protocol-error", "PROTOCOL_ERROR", "协议信封无效")
            continue
        if message.get("type") == "request" and isinstance(message.get("id"), str):
            handle_request(message)
        elif message.get("type") == "control":
            handle_control(message)
        else:
            respond_error("protocol-error", "PROTOCOL_ERROR", "消息形状无效")


if __name__ == "__main__":
    main()
