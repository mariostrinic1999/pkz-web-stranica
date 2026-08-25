const VREMENSKA_ZONA_TEST = "Europe/Zagreb";
const RANGE_POLL_INTERVAL_MS = 3000;
const RANGE_ACTIVE_THRESHOLD_MS = 4 * 60 * 1000;

const trenutniVrijemeEl = document.getElementById("trenutno-vrijeme");
const liveStatusEl = document.getElementById("range-live-status");
const navGpsStatusEl = document.getElementById("nav-gps-status");

const distanceEl = document.getElementById("range-distance");
const rssiEl = document.getElementById("range-rssi");
const snrEl = document.getElementById("range-snr");
const sfEl = document.getElementById("range-sf");
const lastPacketEl = document.getElementById("range-last-packet");
const ageEl = document.getElementById("range-age");
const gatewayEl = document.getElementById("range-gateway");
const fcntEl = document.getElementById("range-fcnt");

const mobileLatEl = document.getElementById("mobile-lat");
const mobileLonEl = document.getElementById("mobile-lon");
const mobileAccuracyEl = document.getElementById("mobile-accuracy");

const gatewayLatInput = document.getElementById("gateway-lat");
const gatewayLonInput = document.getElementById("gateway-lon");
const gatewayPorukaEl = document.getElementById("gateway-poruka");

const pokreniGpsBtn = document.getElementById("pokreni-gps");
const zaustaviGpsBtn = document.getElementById("zaustavi-gps");
const spremiGatewayBtn = document.getElementById("spremi-gateway");
const gatewayTrenutnaLokacijaBtn = document.getElementById("gateway-trenutna-lokacija");

const rangeTableBody = document.getElementById("range-table-body");
const rangeHistoryCountEl = document.getElementById("range-history-count");

let gpsWatchId = null;
let trenutnaPozicija = null;
let gpsPovijest = [];
let zadnjiObradeniPacketId = null;
let zadnjiPacket = null;
let gatewayPozicija = null;

function azurirajVrijemeTesta() {
    if (!trenutniVrijemeEl) return;

    const sada = new Date();
    const datum = sada.toLocaleDateString("hr-HR", { timeZone: VREMENSKA_ZONA_TEST });
    const vrijeme = sada.toLocaleTimeString("hr-HR", {
        timeZone: VREMENSKA_ZONA_TEST,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
    });

    trenutniVrijemeEl.textContent = `${datum} ${vrijeme}`;
}

function formatirajBrojTest(vrijednost, decimale = 1) {
    const broj = Number(vrijednost);
    if (!Number.isFinite(broj)) return "--";

    return broj.toLocaleString("hr-HR", {
        minimumFractionDigits: decimale,
        maximumFractionDigits: decimale
    });
}

function formatirajUdaljenost(metri) {
    const broj = Number(metri);
    if (!Number.isFinite(broj)) return "--";

    if (broj < 1000) {
        return `${Math.round(broj)} m`;
    }

    return `${formatirajBrojTest(broj / 1000, 2)} km`;
}

function radijani(stupnjevi) {
    return stupnjevi * Math.PI / 180;
}

function izracunajUdaljenostMetara(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = radijani(lat2 - lat1);
    const dLon = radijani(lon2 - lon1);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(radijani(lat1)) * Math.cos(radijani(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function procitajGatewayIzPreglednika() {
    const lat = Number(localStorage.getItem("pkz_range_gateway_lat"));
    const lon = Number(localStorage.getItem("pkz_range_gateway_lon"));

    if (Number.isFinite(lat) && Number.isFinite(lon) &&
        lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        gatewayPozicija = { lat, lon };
        gatewayLatInput.value = String(lat);
        gatewayLonInput.value = String(lon);
        return;
    }

    gatewayPozicija = null;
}

function spremiGatewayPoziciju(lat, lon) {
    const latitude = Number(lat);
    const longitude = Number(lon);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
        latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        gatewayPorukaEl.textContent = "Unesi ispravne koordinate gatewaya.";
        return false;
    }

    gatewayPozicija = { lat: latitude, lon: longitude };
    localStorage.setItem("pkz_range_gateway_lat", String(latitude));
    localStorage.setItem("pkz_range_gateway_lon", String(longitude));

    gatewayLatInput.value = String(latitude);
    gatewayLonInput.value = String(longitude);
    gatewayPorukaEl.textContent = "Koordinate gatewaya su spremljene.";

    // Udaljenost se NE računa ovdje. Veže se isključivo uz novi LoRaWAN paket.
    return true;
}

function azurirajTrenutnuUdaljenost() {
    // Trenutna GPS lokacija se i dalje prati, ali se NE prikazuje kao
    // udaljenost zadnjeg LoRaWAN paketa. Udaljenost na kartici smije se
    // promijeniti samo kada stigne novi testni paket.
    if (!gatewayPozicija || !trenutnaPozicija) {
        return null;
    }

    return izracunajUdaljenostMetara(
        gatewayPozicija.lat,
        gatewayPozicija.lon,
        trenutnaPozicija.lat,
        trenutnaPozicija.lon
    );
}

function pokreniGPS() {
    if (!navigator.geolocation) {
        navGpsStatusEl.textContent = "GPS nije podržan";
        gatewayPorukaEl.textContent = "Ovaj preglednik ne podržava GPS lokaciju.";
        return;
    }

    if (gpsWatchId !== null) return;

    navGpsStatusEl.textContent = "Tražim lokaciju...";

    gpsWatchId = navigator.geolocation.watchPosition(
        (position) => {
            trenutnaPozicija = {
                lat: position.coords.latitude,
                lon: position.coords.longitude,
                accuracy: position.coords.accuracy,
                timestamp: Number(position.timestamp) || Date.now()
            };

            gpsPovijest.push({ ...trenutnaPozicija });
            if (gpsPovijest.length > 180) {
                gpsPovijest = gpsPovijest.slice(-180);
            }

            mobileLatEl.textContent = trenutnaPozicija.lat.toFixed(6);
            mobileLonEl.textContent = trenutnaPozicija.lon.toFixed(6);
            mobileAccuracyEl.textContent = `${Math.round(trenutnaPozicija.accuracy)} m`;
            navGpsStatusEl.textContent = `Aktivan ±${Math.round(trenutnaPozicija.accuracy)} m`;

            pokreniGpsBtn.disabled = true;
            zaustaviGpsBtn.disabled = false;

            // GPS samo osvježava poziciju mobitela. Udaljenost se zaključava tek kad stigne novi paket.
            obradiNoviPacketAkoTreba();
        },
        (error) => {
            let poruka = "GPS lokacija nije dostupna.";

            if (error.code === 1) poruka = "Dopuštenje za lokaciju nije odobreno.";
            if (error.code === 2) poruka = "Mobitel trenutačno ne može odrediti lokaciju.";
            if (error.code === 3) poruka = "Isteklo je vrijeme čekanja na GPS lokaciju.";

            navGpsStatusEl.textContent = "GPS nije dostupan";
            gatewayPorukaEl.textContent = poruka;
        },
        {
            enableHighAccuracy: true,
            maximumAge: 2000,
            timeout: 15000
        }
    );
}

function zaustaviGPS() {
    if (gpsWatchId !== null) {
        navigator.geolocation.clearWatch(gpsWatchId);
        gpsWatchId = null;
    }

    navGpsStatusEl.textContent = "GPS zaustavljen";
    pokreniGpsBtn.disabled = false;
    zaustaviGpsBtn.disabled = true;
}

function starostPaketaMs(packet) {
    if (!packet || !packet.received_at_utc) return null;

    const vrijeme = new Date(packet.received_at_utc).getTime();
    if (!Number.isFinite(vrijeme)) return null;

    return Math.max(0, Date.now() - vrijeme);
}

function tekstStarosti(ms) {
    if (!Number.isFinite(ms)) return "--";

    const sekunde = Math.floor(ms / 1000);
    if (sekunde < 60) return `prije ${sekunde} s`;

    const minute = Math.floor(sekunde / 60);
    if (minute < 60) return `prije ${minute} min`;

    const sati = Math.floor(minute / 60);
    return `prije ${sati} h`;
}

function postaviStatusPaketa(packet) {
    zadnjiPacket = packet && packet.id ? packet : null;

    if (!zadnjiPacket) {
        liveStatusEl.textContent = "Čeka testni paket";
        liveStatusEl.className = "status-online status-ceka";
        rssiEl.textContent = "--";
        snrEl.textContent = "--";
        sfEl.textContent = "--";
        lastPacketEl.textContent = "--";
        ageEl.textContent = "Još nema testnih podataka";
        gatewayEl.textContent = "--";
        fcntEl.textContent = "--";
        return;
    }

    const ageMs = starostPaketaMs(zadnjiPacket);
    const aktivan = ageMs !== null && ageMs <= RANGE_ACTIVE_THRESHOLD_MS;

    liveStatusEl.textContent = aktivan ? "Testni paketi stižu" : "Nema novog paketa";
    liveStatusEl.className = aktivan
        ? "status-online status-aktivan"
        : "status-online status-neaktivan";

    rssiEl.textContent = zadnjiPacket.rssi === null || zadnjiPacket.rssi === undefined
        ? "--"
        : `${formatirajBrojTest(zadnjiPacket.rssi, 0)} dBm`;

    snrEl.textContent = zadnjiPacket.snr === null || zadnjiPacket.snr === undefined
        ? "--"
        : `${formatirajBrojTest(zadnjiPacket.snr, 1)} dB`;

    sfEl.textContent = zadnjiPacket.spreading_factor
        ? `SF${zadnjiPacket.spreading_factor}`
        : "--";

    lastPacketEl.textContent = `${zadnjiPacket.datum || ""} ${zadnjiPacket.vrijeme || ""}`.trim() || "--";
    ageEl.textContent = ageMs === null ? "--" : tekstStarosti(ageMs);
    gatewayEl.textContent = zadnjiPacket.gateway_id || "--";
    fcntEl.textContent = zadnjiPacket.f_cnt ?? "--";

    if (zadnjiPacket.distance_m !== null && zadnjiPacket.distance_m !== undefined) {
        // Jednom spremljena udaljenost pripada tom paketu i ostaje fiksna.
        distanceEl.textContent = formatirajUdaljenost(zadnjiPacket.distance_m);
    } else {
        // Dok udaljenost za novi paket još nije povezana s GPS uzorkom,
        // nemoj prikazivati trenutačnu udaljenost vozila.
        distanceEl.textContent = "--";
    }
}

async function spremiPozicijuUzPacket(packet, udaljenost, pozicija) {
    if (!packet || !packet.id || !pozicija || !Number.isFinite(udaljenost)) {
        return null;
    }

    const response = await fetch(`/api/range-test/${packet.id}/position`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        cache: "no-store",
        body: JSON.stringify({
            lat: pozicija.lat,
            lon: pozicija.lon,
            distance_m: udaljenost,
            accuracy_m: pozicija.accuracy
        })
    });

    if (!response.ok) {
        throw new Error("Pozicija nije spremljena.");
    }

    const rezultat = await response.json();

    // Server/baza je jedini autoritet. Ako je neki drugi tab ili uređaj
    // već spremio udaljenost, koristimo baš tu postojeću vrijednost.
    if (rezultat && rezultat.packet) {
        Object.assign(packet, rezultat.packet);
        return rezultat.packet;
    }

    return null;
}

function pronadiGpsPozicijuZaPacket(packet) {
    // Za paket se koristi samo GPS uzorak koji je vremenski blizu trenutku
    // kada je TTN primio taj paket. Ne koristi se kasnija trenutačna lokacija,
    // jer bi se tada udaljenost starog paketa mijenjala tijekom vožnje.
    if (!packet || !packet.received_at_utc || gpsPovijest.length === 0) {
        return null;
    }

    const packetVrijeme = new Date(packet.received_at_utc).getTime();
    if (!Number.isFinite(packetVrijeme)) {
        return null;
    }

    let najbolja = gpsPovijest[0];
    let najmanjaRazlika = Math.abs(najbolja.timestamp - packetVrijeme);

    for (const pozicija of gpsPovijest) {
        const razlika = Math.abs(pozicija.timestamp - packetVrijeme);
        if (razlika < najmanjaRazlika) {
            najbolja = pozicija;
            najmanjaRazlika = razlika;
        }
    }

    // GPS uzorak mora biti unutar 30 sekundi od vremena primitka paketa.
    // Ako ga nema, udaljenost za taj paket ostaje prazna umjesto da se
    // pogrešno veže uz neku kasniju lokaciju vozila.
    if (najmanjaRazlika > 30000) {
        return null;
    }

    return najbolja;
}

async function obradiNoviPacketAkoTreba() {
    if (!zadnjiPacket || !zadnjiPacket.id) return;
    if (zadnjiObradeniPacketId === zadnjiPacket.id) return;

    // Ako je udaljenost već spremljena u bazi, taj paket je završen.
    // Nikad je ponovno ne računaj niti prepisuj novom GPS lokacijom.
    if (zadnjiPacket.distance_m !== null && zadnjiPacket.distance_m !== undefined) {
        zadnjiObradeniPacketId = zadnjiPacket.id;
        distanceEl.textContent = formatirajUdaljenost(zadnjiPacket.distance_m);
        return;
    }

    if (!trenutnaPozicija || !gatewayPozicija) return;

    const pozicijaZaPacket = pronadiGpsPozicijuZaPacket(zadnjiPacket);
    if (!pozicijaZaPacket) return;

    const udaljenost = izracunajUdaljenostMetara(
        gatewayPozicija.lat,
        gatewayPozicija.lon,
        pozicijaZaPacket.lat,
        pozicijaZaPacket.lon
    );

    // Zaključaj obradu ovog paketa prije mrežnog zahtjeva da dva GPS callbacka
    // ne pokušaju istodobno spremiti različite udaljenosti.
    zadnjiObradeniPacketId = zadnjiPacket.id;

    try {
        const spremljeniPacket = await spremiPozicijuUzPacket(
            zadnjiPacket,
            udaljenost,
            pozicijaZaPacket
        );

        // Ne prikazuj privremeno izračunatu vrijednost. Prikaži samo onu
        // koju je baza stvarno zaključala uz taj paket.
        if (spremljeniPacket &&
            spremljeniPacket.distance_m !== null &&
            spremljeniPacket.distance_m !== undefined) {
            distanceEl.textContent = formatirajUdaljenost(spremljeniPacket.distance_m);
        }

        await ucitajPovijestTesta();
    } catch (error) {
        console.error(error);
        // Ako spremanje nije uspjelo, dopusti ponovni pokušaj za isti paket.
        zadnjiObradeniPacketId = null;
    }
}

async function ucitajZadnjiPacket() {
    try {
        const response = await fetch("/api/range-test/latest", { cache: "no-store" });
        if (!response.ok) throw new Error("Ne mogu dohvatiti zadnji testni paket.");

        const packet = await response.json();
        const noviId = packet && packet.id ? packet.id : null;
        const prethodniId = zadnjiPacket && zadnjiPacket.id ? zadnjiPacket.id : null;

        postaviStatusPaketa(packet);

        if (noviId && noviId !== prethodniId) {
            await obradiNoviPacketAkoTreba();
            await ucitajPovijestTesta();
        }
    } catch (error) {
        console.error(error);
        liveStatusEl.textContent = "Greška veze sa serverom";
        liveStatusEl.className = "status-online status-neaktivan";
    }
}

function napraviCeliju(red, tekst) {
    const td = document.createElement("td");
    td.textContent = tekst;
    red.appendChild(td);
}

async function ucitajPovijestTesta() {
    try {
        const response = await fetch("/api/range-test?limit=30", { cache: "no-store" });
        if (!response.ok) throw new Error("Ne mogu dohvatiti povijest testa.");

        const packets = await response.json();
        rangeTableBody.innerHTML = "";

        if (!Array.isArray(packets) || packets.length === 0) {
            const red = document.createElement("tr");
            const td = document.createElement("td");
            td.colSpan = 7;
            td.textContent = "Još nema testnih paketa.";
            red.appendChild(td);
            rangeTableBody.appendChild(red);
            rangeHistoryCountEl.textContent = "0 paketa";
            return;
        }

        packets.forEach((packet) => {
            const red = document.createElement("tr");

            napraviCeliju(red, `${packet.datum || ""} ${packet.vrijeme || ""}`.trim());
            napraviCeliju(red, formatirajUdaljenost(packet.distance_m));
            napraviCeliju(red, packet.rssi === null || packet.rssi === undefined ? "--" : `${formatirajBrojTest(packet.rssi, 0)} dBm`);
            napraviCeliju(red, packet.snr === null || packet.snr === undefined ? "--" : `${formatirajBrojTest(packet.snr, 1)} dB`);
            napraviCeliju(red, packet.spreading_factor ? `SF${packet.spreading_factor}` : "--");
            napraviCeliju(red, packet.f_cnt ?? "--");
            napraviCeliju(red, packet.gateway_id || "--");

            rangeTableBody.appendChild(red);
        });

        rangeHistoryCountEl.textContent = `${packets.length} paketa`;
    } catch (error) {
        console.error(error);
    }
}

spremiGatewayBtn.addEventListener("click", () => {
    spremiGatewayPoziciju(gatewayLatInput.value, gatewayLonInput.value);
});

gatewayTrenutnaLokacijaBtn.addEventListener("click", () => {
    if (!trenutnaPozicija) {
        gatewayPorukaEl.textContent = "Najprije pokreni GPS i pričekaj da mobitel odredi lokaciju.";
        pokreniGPS();
        return;
    }

    spremiGatewayPoziciju(trenutnaPozicija.lat, trenutnaPozicija.lon);
});

pokreniGpsBtn.addEventListener("click", pokreniGPS);
zaustaviGpsBtn.addEventListener("click", zaustaviGPS);

procitajGatewayIzPreglednika();
azurirajVrijemeTesta();
setInterval(azurirajVrijemeTesta, 1000);

ucitajZadnjiPacket();
ucitajPovijestTesta();
setInterval(ucitajZadnjiPacket, RANGE_POLL_INTERVAL_MS);
setInterval(ucitajPovijestTesta, 15000);

// Pokušaj pokrenuti GPS odmah nakon otvaranja stranice.
// Ako preglednik traži korisničku radnju, gumb "Pokreni GPS" ostaje dostupan.
pokreniGPS();
