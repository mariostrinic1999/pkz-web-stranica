from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from flask import Flask, Response, jsonify, request, send_from_directory

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "mjerenja.db"
ZAGREB_TZ = ZoneInfo("Europe/Zagreb")
OPTIONAL_TOKEN = os.environ.get("PKZ_TTN_TOKEN", "").strip()

app = Flask(__name__, static_folder=None)


def init_db() -> None:
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS measurements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                received_at_utc TEXT NOT NULL,
                datum TEXT NOT NULL,
                vrijeme TEXT NOT NULL,
                device_id TEXT,
                pm25 REAL,
                pm10 REAL,
                temperatura REAL,
                vlaga REAL,
                co2 REAL,
                tlak REAL,
                raw_json TEXT NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_measurements_received ON measurements(received_at_utc DESC)")


def to_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def first_number(source: dict[str, Any], names: list[str]) -> float | None:
    lowered = {str(k).lower().replace("_", "").replace(".", ""): v for k, v in source.items()}
    for name in names:
        key = name.lower().replace("_", "").replace(".", "")
        value = to_float(lowered.get(key))
        if value is not None:
            return value
    return None


def parse_received_at(payload: dict[str, Any]) -> datetime:
    uplink = payload.get("uplink_message") or {}
    received_at = payload.get("received_at") or uplink.get("received_at")
    if isinstance(received_at, str) and received_at:
        try:
            return datetime.fromisoformat(received_at.replace("Z", "+00:00")).astimezone(timezone.utc)
        except ValueError:
            pass
    return datetime.now(timezone.utc)


def extract_decoded_payload(payload: dict[str, Any]) -> dict[str, Any]:
    uplink = payload.get("uplink_message") or {}
    decoded = uplink.get("decoded_payload") or payload.get("decoded_payload") or {}
    if isinstance(decoded, dict):
        return decoded
    return {}


def measurement_from_ttn(payload: dict[str, Any]) -> dict[str, Any]:
    decoded = extract_decoded_payload(payload)
    received_utc = parse_received_at(payload)
    local_time = received_utc.astimezone(ZAGREB_TZ)

    end_device_ids = payload.get("end_device_ids") or {}
    device_id = end_device_ids.get("device_id") or payload.get("device_id") or "unknown-device"

    measurement = {
        "received_at_utc": received_utc.isoformat(),
        "datum": local_time.strftime("%Y-%m-%d"),
        "vrijeme": local_time.strftime("%H:%M"),
        "device_id": device_id,
        "pm25": first_number(decoded, ["pm25", "pm2_5", "pm2.5", "PM2.5"]),
        "pm10": first_number(decoded, ["pm10", "PM10"]),
        "temperatura": first_number(decoded, ["temperatura", "temperature", "temp", "t"]),
        "vlaga": first_number(decoded, ["vlaga", "humidity", "rel_humidity", "rh"]),
        "co2": first_number(decoded, ["co2", "co₂", "carbon_dioxide"]),
        "tlak": first_number(decoded, ["tlak", "pressure", "press", "hpa"]),
    }

    required = ["pm25", "pm10", "temperatura", "vlaga", "co2", "tlak"]
    missing = [key for key in required if measurement[key] is None]
    if missing:
        raise ValueError(
            "Nedostaju polja u decoded_payload: " + ", ".join(missing) +
            ". Provjeri TTN uplink payload formatter."
        )

    return measurement


def insert_measurement(measurement: dict[str, Any], raw_payload: dict[str, Any]) -> int:
    with sqlite3.connect(DB_PATH) as conn:
        cur = conn.execute(
            """
            INSERT INTO measurements
            (received_at_utc, datum, vrijeme, device_id, pm25, pm10, temperatura, vlaga, co2, tlak, raw_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                measurement["received_at_utc"],
                measurement["datum"],
                measurement["vrijeme"],
                measurement["device_id"],
                measurement["pm25"],
                measurement["pm10"],
                measurement["temperatura"],
                measurement["vlaga"],
                measurement["co2"],
                measurement["tlak"],
                json.dumps(raw_payload, ensure_ascii=False),
            ),
        )
        return int(cur.lastrowid)


def rows_to_measurements(rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
    measurements = []
    for row in rows:
        measurements.append(
            {
                "id": row["id"],
                "received_at_utc": row["received_at_utc"],
                "datum": row["datum"],
                "vrijeme": row["vrijeme"],
                "device_id": row["device_id"],
                "pm25": row["pm25"],
                "pm10": row["pm10"],
                "temperatura": row["temperatura"],
                "vlaga": row["vlaga"],
                "co2": row["co2"],
                "tlak": row["tlak"],
            }
        )
    return measurements


@app.route("/ttn", methods=["POST"])
def ttn_webhook():
    if OPTIONAL_TOKEN and request.headers.get("X-PKZ-Token") != OPTIONAL_TOKEN:
        return jsonify({"ok": False, "error": "Neispravan token."}), 401

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"ok": False, "error": "Webhook mora poslati JSON."}), 400

    try:
        measurement = measurement_from_ttn(payload)
        measurement_id = insert_measurement(measurement, payload)
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

    return jsonify({"ok": True, "id": measurement_id, "measurement": measurement}), 200


@app.route("/api/measurements", methods=["GET"])
def api_measurements():
    limit = request.args.get("limit", "1000")
    try:
        limit_int = min(max(int(limit), 1), 5000)
    except ValueError:
        limit_int = 1000

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT id, received_at_utc, datum, vrijeme, device_id, pm25, pm10, temperatura, vlaga, co2, tlak
            FROM measurements
            ORDER BY received_at_utc DESC
            LIMIT ?
            """,
            (limit_int,),
        ).fetchall()

    return jsonify(rows_to_measurements(rows))


@app.route("/api/latest", methods=["GET"])
def api_latest():
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            """
            SELECT id, received_at_utc, datum, vrijeme, device_id, pm25, pm10, temperatura, vlaga, co2, tlak
            FROM measurements
            ORDER BY received_at_utc DESC
            LIMIT 1
            """
        ).fetchone()

    return jsonify(rows_to_measurements([row])[0] if row else {})


@app.route("/api/status", methods=["GET"])
def api_status():
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            """
            SELECT id, received_at_utc, datum, vrijeme, device_id, pm25, pm10, temperatura, vlaga, co2, tlak
            FROM measurements
            ORDER BY received_at_utc DESC
            LIMIT 1
            """
        ).fetchone()

    if not row:
        return jsonify({
            "ok": True,
            "has_data": False,
            "status": "offline",
            "text": "Sustav neaktivan",
            "description": "Još nije primljeno nijedno TTN mjerenje.",
            "age_seconds": None,
            "last_measurement": None
        })

    latest = rows_to_measurements([row])[0]
    try:
        received_at = datetime.fromisoformat(row["received_at_utc"].replace("Z", "+00:00")).astimezone(timezone.utc)
    except Exception:
        received_at = datetime.now(timezone.utc)

    age_seconds = max(0, int((datetime.now(timezone.utc) - received_at).total_seconds()))

    if age_seconds <= 180:
        status = "active"
        text = "Sustav aktivan"
        description = "Mjerenja redovito dolaze iz TTN-a."
    elif age_seconds <= 600:
        status = "offline"
        text = "Sustav neaktivan"
        description = "Nije primljeno novo mjerenje u očekivanom vremenu."
    else:
        status = "offline"
        text = "Sustav neaktivan"
        description = "Dulje vrijeme nije primljeno novo mjerenje."

    return jsonify({
        "ok": True,
        "has_data": True,
        "status": status,
        "text": text,
        "description": description,
        "age_seconds": age_seconds,
        "last_measurement": latest
    })


@app.route("/data.js", methods=["GET"])
def data_js():
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT id, received_at_utc, datum, vrijeme, device_id, pm25, pm10, temperatura, vlaga, co2, tlak
            FROM measurements
            ORDER BY received_at_utc DESC
            LIMIT 5000
            """
        ).fetchall()

    content = "window.PKZ_MJERENJA = " + json.dumps(rows_to_measurements(rows), ensure_ascii=False) + ";\n"
    return Response(content, mimetype="application/javascript")


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"ok": True, "database": str(DB_PATH)})


@app.route("/", methods=["GET"])
def index():
    return send_from_directory(BASE_DIR, "index.html")


@app.route("/<path:path>", methods=["GET"])
def static_files(path: str):
    return send_from_directory(BASE_DIR, path)


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000, debug=True)
