from __future__ import annotations

import json
import os
import re
import sqlite3
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import psycopg2
import psycopg2.extras
from flask import Flask, Response, jsonify, request, send_from_directory

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "mjerenja.db"
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
ZAGREB_TZ = ZoneInfo("Europe/Zagreb")
OPTIONAL_TOKEN = os.environ.get("PKZ_TTN_TOKEN", "").strip()
MEASUREMENT_INTERVAL_SECONDS = int(os.environ.get("PKZ_MEASUREMENT_INTERVAL_SECONDS", str(4 * 60 * 60)))
ACTIVE_THRESHOLD_SECONDS = int(os.environ.get("PKZ_ACTIVE_THRESHOLD_SECONDS", str(MEASUREMENT_INTERVAL_SECONDS + 30 * 60)))

app = Flask(__name__, static_folder=None)


@app.after_request
def pkz_no_cache(response):
    if request.path.startswith("/api/") or request.path == "/data.js":
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


def koristi_postgres() -> bool:
    return bool(DATABASE_URL)


def get_conn():
    if koristi_postgres():
        return psycopg2.connect(DATABASE_URL)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def execute(conn, sql_sqlite: str, params: tuple = (), sql_postgres: str | None = None):
    sql = sql_postgres if koristi_postgres() and sql_postgres else sql_sqlite
    cur = conn.cursor()
    cur.execute(sql, params)
    return cur


def slugify(text: str) -> str:
    normalized = unicodedata.normalize("NFKD", text)
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", ascii_text.lower()).strip("-")
    return slug or "lokacija"


DEFAULT_LOCATIONS = [
    {
        "id": "kastel-gomilica",
        "naziv": "Kaštel Gomilica",
        "opis": "Dvorište",
        "lat": 43.55303881627435,
        "lon": 16.39665384424447,
        "active": True,
    },
    {
        "id": "kopilica",
        "naziv": "Kopilica",
        "opis": "Kopilica ul. 5, Split",
        "lat": 43.522799,
        "lon": 16.450543,
        "active": False,
    },
]


def init_db() -> None:
    with get_conn() as conn:
        if koristi_postgres():
            execute(
                conn,
                "",
                sql_postgres="""
                CREATE TABLE IF NOT EXISTS locations (
                    id TEXT PRIMARY KEY,
                    naziv TEXT NOT NULL,
                    opis TEXT,
                    lat DOUBLE PRECISION NOT NULL,
                    lon DOUBLE PRECISION NOT NULL,
                    active BOOLEAN NOT NULL DEFAULT FALSE,
                    created_at_utc TEXT NOT NULL
                )
                """,
            )
            execute(
                conn,
                "",
                sql_postgres="""
                CREATE TABLE IF NOT EXISTS measurements (
                    id SERIAL PRIMARY KEY,
                    received_at_utc TEXT NOT NULL,
                    datum TEXT NOT NULL,
                    vrijeme TEXT NOT NULL,
                    device_id TEXT,
                    pm25 DOUBLE PRECISION,
                    pm10 DOUBLE PRECISION,
                    temperatura DOUBLE PRECISION,
                    vlaga DOUBLE PRECISION,
                    co2 DOUBLE PRECISION,
                    tlak DOUBLE PRECISION,
                    raw_json TEXT NOT NULL
                )
                """,
            )
            execute(conn, "", sql_postgres="ALTER TABLE measurements ADD COLUMN IF NOT EXISTS location_id TEXT")
            execute(conn, "", sql_postgres="CREATE INDEX IF NOT EXISTS idx_measurements_received ON measurements(received_at_utc DESC)")
            execute(conn, "", sql_postgres="CREATE INDEX IF NOT EXISTS idx_measurements_location_received ON measurements(location_id, received_at_utc DESC)")
        else:
            execute(
                conn,
                """
                CREATE TABLE IF NOT EXISTS locations (
                    id TEXT PRIMARY KEY,
                    naziv TEXT NOT NULL,
                    opis TEXT,
                    lat REAL NOT NULL,
                    lon REAL NOT NULL,
                    active INTEGER NOT NULL DEFAULT 0,
                    created_at_utc TEXT NOT NULL
                )
                """,
            )
            execute(
                conn,
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
                """,
            )
            cur = execute(conn, "PRAGMA table_info(measurements)")
            columns = [row[1] for row in cur.fetchall()]
            if "location_id" not in columns:
                execute(conn, "ALTER TABLE measurements ADD COLUMN location_id TEXT")
            execute(conn, "CREATE INDEX IF NOT EXISTS idx_measurements_received ON measurements(received_at_utc DESC)")
            execute(conn, "CREATE INDEX IF NOT EXISTS idx_measurements_location_received ON measurements(location_id, received_at_utc DESC)")

        ensure_default_locations(conn)
        conn.commit()


def row_value(row: Any, key: str) -> Any:
    if isinstance(row, dict):
        return row.get(key)
    return row[key]


def rows_to_locations(rows: list[Any]) -> list[dict[str, Any]]:
    locations = []
    for row in rows:
        locations.append({
            "id": row_value(row, "id"),
            "naziv": row_value(row, "naziv"),
            "opis": row_value(row, "opis") or "",
            "lat": row_value(row, "lat"),
            "lon": row_value(row, "lon"),
            "active": bool(row_value(row, "active")),
            "created_at_utc": row_value(row, "created_at_utc"),
        })
    return locations


def ensure_default_locations(conn) -> None:
    if koristi_postgres():
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT COUNT(*) AS broj FROM locations")
        count = int(cur.fetchone()["broj"])
        if count == 0:
            for loc in DEFAULT_LOCATIONS:
                cur.execute(
                    """
                    INSERT INTO locations (id, naziv, opis, lat, lon, active, created_at_utc)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    (loc["id"], loc["naziv"], loc["opis"], loc["lat"], loc["lon"], loc["active"], datetime.now(timezone.utc).isoformat()),
                )

        cur.execute(
            """
            UPDATE locations
            SET opis = %s, lat = %s, lon = %s
            WHERE id = %s
              AND (opis = %s OR ABS(lat - %s) < 0.000001 OR ABS(lon - %s) < 0.000001)
            """,
            (
                "Dvorište",
                43.55303881627435,
                16.39665384424447,
                "kastel-gomilica",
                "Aktivna lokacija mjerenja u Kaštel Gomilici",
                43.55,
                16.35,
            ),
        )

        cur.execute("SELECT id FROM locations WHERE active = TRUE LIMIT 1")
        active = cur.fetchone()
        if not active:
            cur.execute("UPDATE locations SET active = FALSE")
            cur.execute("UPDATE locations SET active = TRUE WHERE id = (SELECT id FROM locations ORDER BY created_at_utc ASC LIMIT 1)")

        cur.execute("SELECT id FROM locations WHERE active = TRUE LIMIT 1")
        active_id = cur.fetchone()["id"]
        cur.execute("UPDATE measurements SET location_id = %s WHERE location_id IS NULL", (active_id,))
    else:
        cur = execute(conn, "SELECT COUNT(*) AS broj FROM locations")
        count = int(cur.fetchone()["broj"])
        if count == 0:
            for loc in DEFAULT_LOCATIONS:
                execute(
                    conn,
                    """
                    INSERT INTO locations (id, naziv, opis, lat, lon, active, created_at_utc)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (loc["id"], loc["naziv"], loc["opis"], loc["lat"], loc["lon"], 1 if loc["active"] else 0, datetime.now(timezone.utc).isoformat()),
                )

        execute(
            conn,
            """
            UPDATE locations
            SET opis = ?, lat = ?, lon = ?
            WHERE id = ?
              AND (opis = ? OR ABS(lat - ?) < 0.000001 OR ABS(lon - ?) < 0.000001)
            """,
            (
                "Dvorište",
                43.55303881627435,
                16.39665384424447,
                "kastel-gomilica",
                "Aktivna lokacija mjerenja u Kaštel Gomilici",
                43.55,
                16.35,
            ),
        )

        cur = execute(conn, "SELECT id FROM locations WHERE active = 1 LIMIT 1")
        active = cur.fetchone()
        if not active:
            execute(conn, "UPDATE locations SET active = 0")
            execute(conn, "UPDATE locations SET active = 1 WHERE id = (SELECT id FROM locations ORDER BY created_at_utc ASC LIMIT 1)")
        active_id = row_value(execute(conn, "SELECT id FROM locations WHERE active = 1 LIMIT 1").fetchone(), "id")
        execute(conn, "UPDATE measurements SET location_id = ? WHERE location_id IS NULL", (active_id,))


def fetch_locations() -> list[dict[str, Any]]:
    with get_conn() as conn:
        if koristi_postgres():
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute("SELECT id, naziv, opis, lat, lon, active, created_at_utc FROM locations ORDER BY active DESC, naziv ASC")
            rows = cur.fetchall()
        else:
            rows = execute(conn, "SELECT id, naziv, opis, lat, lon, active, created_at_utc FROM locations ORDER BY active DESC, naziv ASC").fetchall()
    return rows_to_locations(rows)


def get_active_location(conn=None) -> dict[str, Any] | None:
    close_conn = False
    if conn is None:
        conn = get_conn()
        close_conn = True

    try:
        if koristi_postgres():
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute("SELECT id, naziv, opis, lat, lon, active, created_at_utc FROM locations WHERE active = TRUE LIMIT 1")
            row = cur.fetchone()
        else:
            row = execute(conn, "SELECT id, naziv, opis, lat, lon, active, created_at_utc FROM locations WHERE active = 1 LIMIT 1").fetchone()

        if not row:
            return None
        return rows_to_locations([row])[0]
    finally:
        if close_conn:
            conn.close()


def set_active_location(location_id: str) -> bool:
    with get_conn() as conn:
        if koristi_postgres():
            cur = conn.cursor()
            cur.execute("SELECT id FROM locations WHERE id = %s", (location_id,))
            if not cur.fetchone():
                return False
            cur.execute("UPDATE locations SET active = FALSE")
            cur.execute("UPDATE locations SET active = TRUE WHERE id = %s", (location_id,))
        else:
            cur = execute(conn, "SELECT id FROM locations WHERE id = ?", (location_id,))
            if not cur.fetchone():
                return False
            execute(conn, "UPDATE locations SET active = 0")
            execute(conn, "UPDATE locations SET active = 1 WHERE id = ?", (location_id,))
        conn.commit()
        return True


def unique_location_id(conn, naziv: str) -> str:
    base = slugify(naziv)
    candidate = base
    i = 2

    while True:
        if koristi_postgres():
            cur = conn.cursor()
            cur.execute("SELECT id FROM locations WHERE id = %s", (candidate,))
            exists = cur.fetchone()
        else:
            exists = execute(conn, "SELECT id FROM locations WHERE id = ?", (candidate,)).fetchone()
        if not exists:
            return candidate
        candidate = f"{base}-{i}"
        i += 1


def create_location(naziv: str, lat: float, lon: float, opis: str = "") -> dict[str, Any]:
    naziv = naziv.strip()
    opis = opis.strip()

    if not naziv:
        raise ValueError("Naziv lokacije je obavezan.")

    with get_conn() as conn:
        location_id = unique_location_id(conn, naziv)
        created_at = datetime.now(timezone.utc).isoformat()

        if koristi_postgres():
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO locations (id, naziv, opis, lat, lon, active, created_at_utc)
                VALUES (%s, %s, %s, %s, %s, FALSE, %s)
                """,
                (location_id, naziv, opis, lat, lon, created_at),
            )
        else:
            execute(
                conn,
                """
                INSERT INTO locations (id, naziv, opis, lat, lon, active, created_at_utc)
                VALUES (?, ?, ?, ?, ?, 0, ?)
                """,
                (location_id, naziv, opis, lat, lon, created_at),
            )

        conn.commit()

    set_active_location(location_id)

    return {
        "id": location_id,
        "naziv": naziv,
        "opis": opis,
        "lat": lat,
        "lon": lon,
        "active": True,
        "created_at_utc": created_at,
    }


def delete_location(location_id: str) -> bool:
    with get_conn() as conn:
        locations = []
        if koristi_postgres():
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute("SELECT id, active FROM locations ORDER BY created_at_utc ASC")
            locations = cur.fetchall()
        else:
            locations = execute(conn, "SELECT id, active FROM locations ORDER BY created_at_utc ASC").fetchall()

        if len(locations) <= 1:
            return False

        exists = any(row_value(loc, "id") == location_id for loc in locations)
        if not exists:
            return False

        was_active = any(row_value(loc, "id") == location_id and bool(row_value(loc, "active")) for loc in locations)

        if koristi_postgres():
            cur = conn.cursor()
            cur.execute("DELETE FROM measurements WHERE location_id = %s", (location_id,))
            cur.execute("DELETE FROM locations WHERE id = %s", (location_id,))
            if was_active:
                cur.execute("UPDATE locations SET active = TRUE WHERE id = (SELECT id FROM locations ORDER BY created_at_utc ASC LIMIT 1)")
        else:
            execute(conn, "DELETE FROM measurements WHERE location_id = ?", (location_id,))
            execute(conn, "DELETE FROM locations WHERE id = ?", (location_id,))
            if was_active:
                execute(conn, "UPDATE locations SET active = 1 WHERE id = (SELECT id FROM locations ORDER BY created_at_utc ASC LIMIT 1)")

        conn.commit()
        return True


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
    with get_conn() as conn:
        active_location = get_active_location(conn)
        location_id = active_location["id"] if active_location else None

        sql_sqlite = """
            INSERT INTO measurements
            (received_at_utc, datum, vrijeme, device_id, pm25, pm10, temperatura, vlaga, co2, tlak, raw_json, location_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        sql_postgres = """
            INSERT INTO measurements
            (received_at_utc, datum, vrijeme, device_id, pm25, pm10, temperatura, vlaga, co2, tlak, raw_json, location_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
        """
        values = (
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
            location_id,
        )

        cur = execute(conn, sql_sqlite, values, sql_postgres)
        if koristi_postgres():
            measurement_id = int(cur.fetchone()[0])
        else:
            measurement_id = int(cur.lastrowid)
        conn.commit()
        return measurement_id


def rows_to_measurements(rows: list[Any]) -> list[dict[str, Any]]:
    measurements = []
    for row in rows:
        measurements.append(
            {
                "id": row_value(row, "id"),
                "received_at_utc": row_value(row, "received_at_utc"),
                "datum": row_value(row, "datum"),
                "vrijeme": row_value(row, "vrijeme"),
                "device_id": row_value(row, "device_id"),
                "pm25": row_value(row, "pm25"),
                "pm10": row_value(row, "pm10"),
                "temperatura": row_value(row, "temperatura"),
                "vlaga": row_value(row, "vlaga"),
                "co2": row_value(row, "co2"),
                "tlak": row_value(row, "tlak"),
                "location_id": row_value(row, "location_id"),
                "location_name": row_value(row, "location_name"),
            }
        )
    return measurements


def fetch_measurements(limit: int = 1000, location_id: str | None = None) -> list[dict[str, Any]]:
    with get_conn() as conn:
        if location_id is None:
            active_location = get_active_location(conn)
            location_id = active_location["id"] if active_location else None

        all_locations = location_id == "all"

        if koristi_postgres():
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            if all_locations or not location_id:
                cur.execute(
                    """
                    SELECT m.id, m.received_at_utc, m.datum, m.vrijeme, m.device_id,
                           m.pm25, m.pm10, m.temperatura, m.vlaga, m.co2, m.tlak,
                           m.location_id, l.naziv AS location_name
                    FROM measurements m
                    LEFT JOIN locations l ON l.id = m.location_id
                    ORDER BY m.received_at_utc DESC
                    LIMIT %s
                    """,
                    (limit,),
                )
            else:
                cur.execute(
                    """
                    SELECT m.id, m.received_at_utc, m.datum, m.vrijeme, m.device_id,
                           m.pm25, m.pm10, m.temperatura, m.vlaga, m.co2, m.tlak,
                           m.location_id, l.naziv AS location_name
                    FROM measurements m
                    LEFT JOIN locations l ON l.id = m.location_id
                    WHERE m.location_id = %s
                    ORDER BY m.received_at_utc DESC
                    LIMIT %s
                    """,
                    (location_id, limit),
                )
            rows = cur.fetchall()
        else:
            if all_locations or not location_id:
                rows = execute(
                    conn,
                    """
                    SELECT m.id, m.received_at_utc, m.datum, m.vrijeme, m.device_id,
                           m.pm25, m.pm10, m.temperatura, m.vlaga, m.co2, m.tlak,
                           m.location_id, l.naziv AS location_name
                    FROM measurements m
                    LEFT JOIN locations l ON l.id = m.location_id
                    ORDER BY m.received_at_utc DESC
                    LIMIT ?
                    """,
                    (limit,),
                ).fetchall()
            else:
                rows = execute(
                    conn,
                    """
                    SELECT m.id, m.received_at_utc, m.datum, m.vrijeme, m.device_id,
                           m.pm25, m.pm10, m.temperatura, m.vlaga, m.co2, m.tlak,
                           m.location_id, l.naziv AS location_name
                    FROM measurements m
                    LEFT JOIN locations l ON l.id = m.location_id
                    WHERE m.location_id = ?
                    ORDER BY m.received_at_utc DESC
                    LIMIT ?
                    """,
                    (location_id, limit),
                ).fetchall()

    return rows_to_measurements(rows)


def fetch_latest(location_id: str | None = None) -> dict[str, Any] | None:
    rows = fetch_measurements(1, location_id)
    return rows[0] if rows else None


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


@app.route("/api/locations", methods=["GET"])
def api_locations():
    locations = fetch_locations()
    active_location = next((loc for loc in locations if loc["active"]), locations[0] if locations else None)
    return jsonify({
        "ok": True,
        "locations": locations,
        "active_location_id": active_location["id"] if active_location else None,
        "active_location": active_location
    })


@app.route("/api/locations", methods=["POST"])
def api_create_location():
    data = request.get_json(silent=True) or {}

    try:
        naziv = str(data.get("naziv") or "").strip()
        opis = str(data.get("opis") or "").strip()
        lat = float(data.get("lat"))
        lon = float(data.get("lon"))
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise ValueError("Koordinate nisu ispravne.")

        location = create_location(naziv, lat, lon, opis)
        return jsonify({"ok": True, "location": location, "locations": fetch_locations()}), 201
    except (TypeError, ValueError) as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/api/locations/active", methods=["POST"])
def api_set_active_location():
    data = request.get_json(silent=True) or {}
    location_id = str(data.get("location_id") or data.get("id") or "").strip()

    if not location_id:
        return jsonify({"ok": False, "error": "Nedostaje ID lokacije."}), 400

    if not set_active_location(location_id):
        return jsonify({"ok": False, "error": "Lokacija nije pronađena."}), 404

    return jsonify({"ok": True, "active_location_id": location_id, "locations": fetch_locations()})


@app.route("/api/locations/<location_id>", methods=["DELETE"])
def api_delete_location(location_id: str):
    if not delete_location(location_id):
        return jsonify({"ok": False, "error": "Lokacija se ne može izbrisati."}), 400

    return jsonify({"ok": True, "locations": fetch_locations()})


@app.route("/api/measurements", methods=["GET"])
def api_measurements():
    limit = request.args.get("limit", "1000")
    location_id = request.args.get("location_id")

    try:
        limit_int = min(max(int(limit), 1), 5000)
    except ValueError:
        limit_int = 1000

    return jsonify(fetch_measurements(limit_int, location_id))


@app.route("/api/latest", methods=["GET"])
def api_latest():
    location_id = request.args.get("location_id")
    return jsonify(fetch_latest(location_id) or {})


@app.route("/api/status", methods=["GET"])
def api_status():
    active_location = None
    with get_conn() as conn:
        active_location = get_active_location(conn)

    latest = fetch_latest(active_location["id"] if active_location else None)

    if not latest:
        return jsonify({
            "ok": True,
            "has_data": False,
            "status": "offline",
            "text": "Sustav neaktivan",
            "description": "Još nije primljeno nijedno TTN mjerenje za aktivnu lokaciju.",
            "age_seconds": None,
            "last_measurement": None,
            "active_location": active_location,
        })

    try:
        received_at = datetime.fromisoformat(str(latest["received_at_utc"]).replace("Z", "+00:00")).astimezone(timezone.utc)
    except Exception:
        received_at = datetime.now(timezone.utc)

    age_seconds = max(0, int((datetime.now(timezone.utc) - received_at).total_seconds()))

    if age_seconds <= ACTIVE_THRESHOLD_SECONDS:
        status = "active"
        text = "Sustav aktivan"
        description = "Zadnje mjerenje je unutar očekivanog intervala slanja."
    else:
        status = "offline"
        text = "Sustav neaktivan"
        description = "Nije primljeno novo mjerenje u očekivanom intervalu."

    return jsonify({
        "ok": True,
        "has_data": True,
        "status": status,
        "text": text,
        "description": description,
        "age_seconds": age_seconds,
        "last_measurement": latest,
        "active_location": active_location,
    })


@app.route("/data.js", methods=["GET"])
def data_js():
    with get_conn() as conn:
        active_location = get_active_location(conn)

    content = (
        "window.PKZ_AKTIVNA_LOKACIJA = " + json.dumps(active_location, ensure_ascii=False) + ";\n" +
        "window.PKZ_MJERENJA = " + json.dumps(fetch_measurements(5000, active_location["id"] if active_location else None), ensure_ascii=False) + ";\n"
    )
    return Response(content, mimetype="application/javascript")


@app.route("/health", methods=["GET"])
def health():
    with get_conn() as conn:
        active_location = get_active_location(conn)

    return jsonify({
        "ok": True,
        "database": "postgres" if koristi_postgres() else str(DB_PATH),
        "active_location": active_location
    })


@app.route("/", methods=["GET"])
def index():
    return send_from_directory(BASE_DIR, "index.html")


@app.route("/<path:path>", methods=["GET"])
def static_files(path: str):
    return send_from_directory(BASE_DIR, path)


init_db()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")), debug=True)
