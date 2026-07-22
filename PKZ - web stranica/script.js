const VREMENSKA_ZONA = "Europe/Zagreb";

function formatirajDatumHR(datumString) {
    const datum = new Date(`${datumString}T00:00:00`);

    const dijelovi = new Intl.DateTimeFormat("hr-HR", {
        timeZone: VREMENSKA_ZONA,
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    }).formatToParts(datum);

    const dan = dijelovi.find(dio => dio.type === "day").value;
    const mjesec = dijelovi.find(dio => dio.type === "month").value;
    const godina = dijelovi.find(dio => dio.type === "year").value;

    return `${dan}.${mjesec}.${godina}.`;
}

function formatirajBroj(vrijednost, decimale = 1) {
    return Number(vrijednost).toLocaleString("hr-HR", {
        minimumFractionDigits: decimale,
        maximumFractionDigits: decimale
    });
}

function dohvatiNazivMjeseca(mjesecBroj) {
    const mjeseci = [
        "Siječanj", "Veljača", "Ožujak", "Travanj",
        "Svibanj", "Lipanj", "Srpanj", "Kolovoz",
        "Rujan", "Listopad", "Studeni", "Prosinac"
    ];

    return mjeseci[mjesecBroj - 1] || "";
}

function dohvatiTekstMjesecGodina(godina, mjesec) {
    return `${dohvatiNazivMjeseca(Number(mjesec))} ${godina}.`;
}

function dohvatiDijeloveDatumaZaZagreb(datum = new Date()) {
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: VREMENSKA_ZONA,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
    });

    const dijelovi = formatter.formatToParts(datum);
    const vrijednosti = {};

    dijelovi.forEach((dio) => {
        if (dio.type !== "literal") {
            vrijednosti[dio.type] = dio.value;
        }
    });

    return {
        godina: vrijednosti.year,
        mjesec: vrijednosti.month,
        dan: vrijednosti.day,
        sat: vrijednosti.hour,
        minuta: vrijednosti.minute,
        sekunda: vrijednosti.second
    };
}

function dohvatiTrenutniZagrebDatumIVrijemeTekst() {
    const sada = dohvatiDijeloveDatumaZaZagreb();
    return `${sada.godina}-${sada.mjesec}-${sada.dan} ${sada.sat}:${sada.minuta}:${sada.sekunda}`;
}

function pretvoriMjerenjeUKljucVremena(mjerenje) {
    return `${mjerenje.datum} ${mjerenje.vrijeme}`;
}

function usporediMjerenjaOdNajnovijeg(a, b) {
    return pretvoriMjerenjeUKljucVremena(b).localeCompare(pretvoriMjerenjeUKljucVremena(a));
}

function filtrirajBuducaMjerenja(listaMjerenja) {
    const trenutnoZagrebVrijeme = dohvatiTrenutniZagrebDatumIVrijemeTekst().slice(0, 16);

    return listaMjerenja.filter((mjerenje) => {
        return pretvoriMjerenjeUKljucVremena(mjerenje) <= trenutnoZagrebVrijeme;
    });
}

function odrediDeterministickiPomak(datum, sat, pomakKanala) {
    const brojDatuma = Number(datum.replaceAll("-", ""));
    const osnovno = Math.sin((brojDatuma + sat * 17 + pomakKanala * 31) * 0.13) + Math.cos((brojDatuma + sat * 11 + pomakKanala * 19) * 0.07);
    return osnovno * 0.8;
}

const trenutnoVrijeme = document.getElementById("trenutno-vrijeme");
const statusZadnjeOcitanje = document.getElementById("status-zadnje-ocitanje");

function azurirajVrijeme() {
    if (!trenutnoVrijeme) return;

    const sada = new Date();

    const datum = sada.toLocaleDateString("hr-HR", {
        timeZone: VREMENSKA_ZONA
    });

    const vrijeme = sada.toLocaleTimeString("hr-HR", {
        timeZone: VREMENSKA_ZONA,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
    });

    trenutnoVrijeme.innerText = datum + " " + vrijeme;
}

azurirajVrijeme();
setInterval(azurirajVrijeme, 1000);

/* Povijest mjerenja za arhivu */
function generirajMjerenjaZaDan(datum, bazaPM25, bazaPM10, bazaTemperatura, bazaVlaga, bazaCO2, bazaTlak) {
    const mjerenja = [];

    for (let sat = 0; sat < 24; sat++) {
        const vrijeme = String(sat).padStart(2, "0") + ":00";

        const pm25 = Math.max(8, Math.round(
            bazaPM25 +
            Math.sin(sat / 3) * 3 +
            (sat > 13 && sat < 18 ? 2 : 0) +
            odrediDeterministickiPomak(datum, sat, 1)
        ));

        const pm10 = Math.max(15, Math.round(
            bazaPM10 +
            Math.sin(sat / 3.5) * 4 +
            (sat > 13 && sat < 18 ? 3 : 0) +
            odrediDeterministickiPomak(datum, sat, 2)
        ));

        const temperatura = Math.round(
            bazaTemperatura +
            Math.sin((sat - 8) / 24 * Math.PI * 2) * 5 +
            odrediDeterministickiPomak(datum, sat, 3)
        );

        const vlaga = Math.max(35, Math.round(
            bazaVlaga -
            Math.sin((sat - 8) / 24 * Math.PI * 2) * 8 +
            odrediDeterministickiPomak(datum, sat, 4)
        ));

        const co2 = Math.max(380, Math.round(
            bazaCO2 +
            Math.sin((sat - 6) / 24 * Math.PI * 2) * 45 +
            (sat > 17 && sat < 23 ? 70 : 0) +
            odrediDeterministickiPomak(datum, sat, 5) * 12
        ));

        const tlak = Number((
            bazaTlak +
            Math.sin((sat - 4) / 24 * Math.PI * 2) * 1.8 +
            odrediDeterministickiPomak(datum, sat, 6) * 0.6
        ).toFixed(1));

        mjerenja.push({
            datum,
            vrijeme,
            pm25,
            pm10,
            temperatura,
            vlaga,
            co2,
            tlak
        });
    }

    return mjerenja;
}

function generirajPovijestMjerenja(pocetniDatum, brojDana) {
    const svaMjerenja = [];
    const datum = new Date(`${pocetniDatum}T00:00:00`);

    for (let i = 0; i < brojDana; i++) {
        const godina = datum.getFullYear();
        const mjesec = String(datum.getMonth() + 1).padStart(2, "0");
        const dan = String(datum.getDate()).padStart(2, "0");

        const datumTekst = `${godina}-${mjesec}-${dan}`;

        const sezona = Math.sin((i / 365) * Math.PI * 2);
        const bazaPM25 = 12 + (i % 5) + sezona * 2;
        const bazaPM10 = 20 + (i % 7) + sezona * 2;
        const bazaTemperatura = 16 + Math.sin((i / 365) * Math.PI * 2) * 10;
        const bazaVlaga = 60 + Math.cos((i / 365) * Math.PI * 2) * 6;
        const bazaCO2 = 520 + (i % 6) * 12 + Math.cos((i / 365) * Math.PI * 2) * 35;
        const bazaTlak = 1013 + Math.sin((i / 365) * Math.PI * 2) * 7;

        svaMjerenja.push(
            ...generirajMjerenjaZaDan(
                datumTekst,
                bazaPM25,
                bazaPM10,
                bazaTemperatura,
                bazaVlaga,
                bazaCO2,
                bazaTlak
            )
        );

        datum.setDate(datum.getDate() + 1);
    }

    return svaMjerenja;
}

function ucitajMjerenjaSaServera() {
    if (!Array.isArray(window.PKZ_MJERENJA)) return [];

    return window.PKZ_MJERENJA
        .map((mjerenje) => ({
            id: mjerenje.id,
            received_at_utc: mjerenje.received_at_utc,
            datum: mjerenje.datum,
            vrijeme: mjerenje.vrijeme,
            pm25: Number(mjerenje.pm25),
            pm10: Number(mjerenje.pm10),
            temperatura: Number(mjerenje.temperatura),
            vlaga: Number(mjerenje.vlaga),
            co2: Number(mjerenje.co2),
            tlak: Number(mjerenje.tlak),
            location_id: mjerenje.location_id || null,
            location_name: mjerenje.location_name || ""
        }))
        .filter((mjerenje) => {
            return mjerenje.datum && mjerenje.vrijeme &&
                !Number.isNaN(mjerenje.pm25) &&
                !Number.isNaN(mjerenje.pm10) &&
                !Number.isNaN(mjerenje.temperatura) &&
                !Number.isNaN(mjerenje.vlaga) &&
                !Number.isNaN(mjerenje.co2) &&
                !Number.isNaN(mjerenje.tlak);
        });
}

const stvarnaMjerenja = ucitajMjerenjaSaServera();
const aktivnaLokacijaServer = window.PKZ_AKTIVNA_LOKACIJA || null;
const navLokacijaNaziv = document.getElementById("nav-lokacija-naziv");
const footerLokacijaNaziv = document.getElementById("footer-lokacija-naziv");

function formatirajKoordinatu(vrijednost) {
    const broj = Number(vrijednost);
    if (Number.isNaN(broj)) return "--";
    return broj.toFixed(14).replace(/0+$/, "").replace(/\.$/, "");
}

function pkzAzurirajPrikazAktivneLokacije(lokacija) {
    const naziv = lokacija && lokacija.naziv ? lokacija.naziv : "--";

    if (navLokacijaNaziv) navLokacijaNaziv.textContent = naziv;
    if (footerLokacijaNaziv) footerLokacijaNaziv.textContent = naziv;
}

pkzAzurirajPrikazAktivneLokacije(aktivnaLokacijaServer);

// Online verzija: prikazuju se samo stvarna mjerenja iz baze.
// Ako je baza prazna, ne generiraju se probni/demo podaci.
const povijestMjerenja = stvarnaMjerenja.sort(usporediMjerenjaOdNajnovijeg);

/* Zadnje mjerenje za početnu */
const zadnjeMjerenje = povijestMjerenja[0];
const prethodnoMjerenje = povijestMjerenja[1];

const mjerenja = zadnjeMjerenje ? {
    pm25: zadnjeMjerenje.pm25,
    pm10: zadnjeMjerenje.pm10,
    temperatura: zadnjeMjerenje.temperatura,
    vlaga: zadnjeMjerenje.vlaga,
    co2: zadnjeMjerenje.co2,
    tlak: zadnjeMjerenje.tlak
} : {
    pm25: "--",
    pm10: "--",
    temperatura: "--",
    vlaga: "--",
    co2: "--",
    tlak: "--"
};

/* Kartice */
const pm25Element = document.getElementById("pm25");
const pm10Element = document.getElementById("pm10");
const tempElement = document.getElementById("temp");
const vlagaElement = document.getElementById("vlaga");
const co2Element = document.getElementById("co2");
const tlakElement = document.getElementById("tlak");

if (pm25Element) pm25Element.innerText = mjerenja.pm25 + " µg/m³";
if (pm10Element) pm10Element.innerText = mjerenja.pm10 + " µg/m³";
if (tempElement) tempElement.innerText = mjerenja.temperatura + " °C";
if (vlagaElement) vlagaElement.innerText = mjerenja.vlaga + " %";
if (co2Element) co2Element.innerText = mjerenja.co2 + " ppm";
if (tlakElement) tlakElement.innerText = mjerenja.tlak + " hPa";

/* Kvaliteta zraka i alarm */
const kvalitetaKartica = document.getElementById("kvaliteta-kartica");
const kvalitetaZraka = document.getElementById("kvaliteta-zraka");
const kvalitetaOpis = document.getElementById("kvaliteta-opis");

const alarmBox = document.getElementById("alarm-box");
const alarmStatus = document.getElementById("alarm-status");
const alarmOpis = document.getElementById("alarm-opis");

if (kvalitetaKartica && kvalitetaZraka && kvalitetaOpis && alarmBox && alarmStatus && alarmOpis && zadnjeMjerenje) {
    if (mjerenja.pm25 <= 15) {
        kvalitetaZraka.innerText = "Dobra";
        kvalitetaOpis.innerText = "Vrijednosti su u prihvatljivom rasponu";
        kvalitetaKartica.classList.add("kvaliteta-dobra");

        alarmStatus.innerText = "Nema aktivnih alarma";
        alarmOpis.innerText = "Vrijednosti su unutar normalnih granica.";
        alarmBox.classList.add("alarm-normalno");
    } else if (mjerenja.pm25 <= 35) {
        kvalitetaZraka.innerText = "Umjerena";
        kvalitetaOpis.innerText = "Povišene vrijednosti čestica u zraku";
        kvalitetaKartica.classList.add("kvaliteta-umjerena");

        alarmStatus.innerText = "Upozorenje";
        alarmOpis.innerText = "Povišena koncentracija PM2.5 čestica.";
        alarmBox.classList.add("alarm-upozorenje");
    } else {
        kvalitetaZraka.innerText = "Loša";
        kvalitetaOpis.innerText = "Visoke vrijednosti čestica u zraku";
        kvalitetaKartica.classList.add("kvaliteta-losa");

        alarmStatus.innerText = "Kritično stanje";
        alarmOpis.innerText = "Visoka koncentracija PM2.5 čestica. Potrebna je pažnja.";
        alarmBox.classList.add("alarm-kriticno");
    }
}

/* Statusi vrijednosti na početnoj stranici */
const statusPM25 = document.getElementById("status-pm25");
const statusPM10 = document.getElementById("status-pm10");
const statusCO2 = document.getElementById("status-co2");

function odrediStatusPM25(vrijednost) {
    if (vrijednost <= 15) return { tekst: "Normalno", klasa: "status-normalno" };
    if (vrijednost <= 35) return { tekst: "Povišeno", klasa: "status-poviseno" };
    return { tekst: "Visoko", klasa: "status-visoko" };
}

function odrediStatusPM10(vrijednost) {
    if (vrijednost <= 25) return { tekst: "Normalno", klasa: "status-normalno" };
    if (vrijednost <= 50) return { tekst: "Povišeno", klasa: "status-poviseno" };
    return { tekst: "Visoko", klasa: "status-visoko" };
}

function odrediStatusCO2(vrijednost) {
    if (vrijednost <= 800) return { tekst: "Normalno", klasa: "status-normalno" };
    if (vrijednost <= 1200) return { tekst: "Povišeno", klasa: "status-poviseno" };
    return { tekst: "Visoko", klasa: "status-visoko" };
}

function prikaziStatuseKartica() {
    if (!zadnjeMjerenje) return;

    if (statusPM25) {
        const status = odrediStatusPM25(mjerenja.pm25);
        statusPM25.innerText = status.tekst;
        statusPM25.className = "vrijednost-status " + status.klasa;
    }

    if (statusPM10) {
        const status = odrediStatusPM10(mjerenja.pm10);
        statusPM10.innerText = status.tekst;
        statusPM10.className = "vrijednost-status " + status.klasa;
    }

    if (statusCO2) {
        const status = odrediStatusCO2(mjerenja.co2);
        statusCO2.innerText = status.tekst;
        statusCO2.className = "vrijednost-status " + status.klasa;
    }
}

prikaziStatuseKartica();

/* Trendovi za okolišne vrijednosti */
const trendTemperatura = document.getElementById("trend-temperatura");
const trendVlaga = document.getElementById("trend-vlaga");
const trendTlak = document.getElementById("trend-tlak");

function odrediTrendPostotkom(trenutnaVrijednost, prethodnaVrijednost, pragPostotak) {
    if (
        trenutnaVrijednost === null || trenutnaVrijednost === undefined ||
        prethodnaVrijednost === null || prethodnaVrijednost === undefined ||
        Number(prethodnaVrijednost) === 0
    ) {
        return { tekst: "Nema prethodnog podatka", klasa: "trend-stabilno" };
    }

    const promjenaPostotak = ((Number(trenutnaVrijednost) - Number(prethodnaVrijednost)) / Number(prethodnaVrijednost)) * 100;

    if (promjenaPostotak > pragPostotak) {
        return { tekst: "Raste ↑", klasa: "trend-rast" };
    }

    if (promjenaPostotak < -pragPostotak) {
        return { tekst: "Pada ↓", klasa: "trend-pad" };
    }

    return { tekst: "Stabilno →", klasa: "trend-stabilno" };
}

function prikaziTrend(element, trend) {
    if (!element || !trend) return;
    element.innerText = trend.tekst;
    element.className = "trend " + trend.klasa;
}

function prikaziTrendoveKartica() {
    if (!zadnjeMjerenje || !prethodnoMjerenje) return;

    prikaziTrend(
        trendTemperatura,
        odrediTrendPostotkom(zadnjeMjerenje.temperatura, prethodnoMjerenje.temperatura, 5)
    );

    prikaziTrend(
        trendVlaga,
        odrediTrendPostotkom(zadnjeMjerenje.vlaga, prethodnoMjerenje.vlaga, 5)
    );

    prikaziTrend(
        trendTlak,
        odrediTrendPostotkom(zadnjeMjerenje.tlak, prethodnoMjerenje.tlak, 0.5)
    );
}

prikaziTrendoveKartica();


/* Zadnje očitanje */
function prikaziZadnjeOcitanje() {
    if (!statusZadnjeOcitanje || !zadnjeMjerenje) return;
    statusZadnjeOcitanje.innerText = formatirajDatumHR(zadnjeMjerenje.datum) + " " + zadnjeMjerenje.vrijeme;
}

prikaziZadnjeOcitanje();

/* Pomoćne funkcije za boje vrijednosti */
function odrediKlasuPM25(vrijednost) {
    if (vrijednost <= 15) return "vrijednost-normalna";
    if (vrijednost <= 35) return "vrijednost-upozorenje";
    return "vrijednost-kriticna";
}

function odrediKlasuPM10(vrijednost) {
    if (vrijednost <= 25) return "vrijednost-normalna";
    if (vrijednost <= 50) return "vrijednost-upozorenje";
    return "vrijednost-kriticna";
}

/* Arhiva */
const filterGodina = document.getElementById("filter-godina");
const filterMjesec = document.getElementById("filter-mjesec");
const filterDan = document.getElementById("filter-dan");
const filterOd = document.getElementById("filter-od");
const filterDo = document.getElementById("filter-do");
const pretragaTablice = document.getElementById("pretraga-tablice");
const preuzmiExcelGumb = document.getElementById("preuzmi-csv");
const resetFilteraGumb = document.getElementById("reset-filtera");
const naslovArhive = document.getElementById("arhiva-naslov");
const opisArhive = document.getElementById("arhiva-opis");
const sazetakArhive = document.getElementById("arhiva-sazetak");
const panelMjesecni = document.getElementById("panel-mjesecni");
const mjesecniThead = document.getElementById("mjesecni-thead");
const mjesecniTbody = document.getElementById("mjesecni-tbody");
const naslovMjesecneTablice = document.getElementById("mjesecni-naslov");
const glavnaThead = document.getElementById("glavna-thead");
const glavnaTbody = document.getElementById("tablica-mjerenja-body");
const naslovGlavneTablice = document.getElementById("glavna-tablica-naslov");
const podnaslovGlavneTablice = document.getElementById("glavna-tablica-opis");

function popuniGodine() {
    if (!filterGodina) return;

    const godine = [...new Set(
        povijestMjerenja.map((mjerenje) => Number(mjerenje.datum.slice(0, 4)))
    )].sort((a, b) => b - a);

    godine.forEach((godina) => {
        const opcija = document.createElement("option");
        opcija.value = godina;
        opcija.textContent = godina;
        filterGodina.appendChild(opcija);
    });
}

function postaviRasponDatumskihFiltera() {
    const sviDatumi = povijestMjerenja.map((mjerenje) => mjerenje.datum).sort();
    const prviDatum = sviDatumi[0];
    const zadnjiDatum = sviDatumi[sviDatumi.length - 1];

    [filterDan, filterOd, filterDo].forEach((element) => {
        if (!element) return;
        element.min = prviDatum;
        element.max = zadnjiDatum;
    });
}

function izracunajProsjeke(listaMjerenja) {
    if (!listaMjerenja.length) {
        return null;
    }

    const zbroj = listaMjerenja.reduce((akumulator, mjerenje) => {
        akumulator.pm25 += mjerenje.pm25;
        akumulator.pm10 += mjerenje.pm10;
        akumulator.temperatura += mjerenje.temperatura;
        akumulator.vlaga += mjerenje.vlaga;
        akumulator.co2 += mjerenje.co2;
        akumulator.tlak += mjerenje.tlak;
        return akumulator;
    }, {
        pm25: 0,
        pm10: 0,
        temperatura: 0,
        vlaga: 0,
        co2: 0,
        tlak: 0
    });

    return {
        pm25: Number((zbroj.pm25 / listaMjerenja.length).toFixed(1)),
        pm10: Number((zbroj.pm10 / listaMjerenja.length).toFixed(1)),
        temperatura: Number((zbroj.temperatura / listaMjerenja.length).toFixed(1)),
        vlaga: Number((zbroj.vlaga / listaMjerenja.length).toFixed(1)),
        co2: Number((zbroj.co2 / listaMjerenja.length).toFixed(1)),
        tlak: Number((zbroj.tlak / listaMjerenja.length).toFixed(1)),
        brojMjerenja: listaMjerenja.length
    };
}

function grupirajPoDanu(listaMjerenja) {
    const mapa = new Map();

    listaMjerenja.forEach((mjerenje) => {
        if (!mapa.has(mjerenje.datum)) {
            mapa.set(mjerenje.datum, []);
        }
        mapa.get(mjerenje.datum).push(mjerenje);
    });

    return [...mapa.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([datum, stavke]) => ({
            datum,
            oznaka: formatirajDatumHR(datum),
            ...izracunajProsjeke(stavke)
        }));
}

function grupirajPoMjesecu(listaMjerenja) {
    const mapa = new Map();

    listaMjerenja.forEach((mjerenje) => {
        const kljuc = mjerenje.datum.slice(0, 7);
        if (!mapa.has(kljuc)) {
            mapa.set(kljuc, []);
        }
        mapa.get(kljuc).push(mjerenje);
    });

    return [...mapa.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([mjesecKljuc, stavke]) => {
            const godina = mjesecKljuc.slice(0, 4);
            const mjesec = mjesecKljuc.slice(5, 7);

            return {
                mjesecKljuc,
                oznaka: dohvatiTekstMjesecGodina(godina, mjesec),
                ...izracunajProsjeke(stavke)
            };
        });
}

function filtrirajPoRasponu(listaMjerenja, odDatum, doDatum) {
    return listaMjerenja.filter((mjerenje) => {
        return mjerenje.datum >= odDatum && mjerenje.datum <= doDatum;
    });
}

function odrediNacinPrikaza() {
    const godina = filterGodina ? filterGodina.value : "";
    const mjesec = filterMjesec ? filterMjesec.value : "";
    const dan = filterDan ? filterDan.value : "";
    const od = filterOd ? filterOd.value : "";
    const doDatuma = filterDo ? filterDo.value : "";

    if (od && doDatuma) {
        return { vrsta: "interval", od, do: doDatuma };
    }

    if (dan) {
        return { vrsta: "dan", datum: dan };
    }

    if (godina && mjesec) {
        return { vrsta: "mjesec", godina, mjesec: String(mjesec).padStart(2, "0") };
    }

    if (godina) {
        return { vrsta: "godina", godina };
    }

    return { vrsta: "razdoblje" };
}

function pripremiPrikazArhive() {
    const odabir = odrediNacinPrikaza();
    let osnovnaLista = [...povijestMjerenja];
    let naslov = "Arhiva kvalitete zraka za dostupno razdoblje";
    let opis = "Prikazan je ukupni prosjek, mjesečni prosjeci i dnevni prosjeci za sve dostupne podatke.";
    let naslovSazetka = "Prosjek dostupnog razdoblja";
    let sporednaSekcija = null;
    let glavnaSekcija = null;

    if (odabir.vrsta === "godina") {
        osnovnaLista = osnovnaLista.filter((mjerenje) => mjerenje.datum.startsWith(odabir.godina));
        naslov = `Arhiva kvalitete zraka za ${odabir.godina}.`;
        opis = "Prikazan je godišnji prosjek, mjesečni prosjeci i dnevni prosjeci za odabranu godinu.";
        naslovSazetka = "Prosjek godine";
    } else if (odabir.vrsta === "mjesec") {
        osnovnaLista = osnovnaLista.filter((mjerenje) => {
            return mjerenje.datum.slice(0, 4) === odabir.godina && mjerenje.datum.slice(5, 7) === odabir.mjesec;
        });
        naslov = `Arhiva kvalitete zraka za ${dohvatiTekstMjesecGodina(odabir.godina, odabir.mjesec)}`;
        opis = "Prikazan je prosjek mjeseca i dnevni prosjeci za odabrani mjesec.";
        naslovSazetka = "Prosjek mjeseca";
    } else if (odabir.vrsta === "dan") {
        osnovnaLista = osnovnaLista.filter((mjerenje) => mjerenje.datum === odabir.datum);
        naslov = `Arhiva kvalitete zraka za ${formatirajDatumHR(odabir.datum)}`;
        opis = "Prikazan je prosjek dana i sva satna mjerenja za odabrani datum.";
        naslovSazetka = "Prosjek dana";
    } else if (odabir.vrsta === "interval") {
        osnovnaLista = filtrirajPoRasponu(osnovnaLista, odabir.od, odabir.do);
        naslov = `Arhiva kvalitete zraka od ${formatirajDatumHR(odabir.od)} do ${formatirajDatumHR(odabir.do)}`;
        opis = "Prikazan je prosjek odabranog intervala i dnevni prosjeci unutar tog razdoblja.";
        naslovSazetka = "Prosjek intervala";
    }

    const sazetak = izracunajProsjeke(osnovnaLista);

    if (odabir.vrsta === "godina" || odabir.vrsta === "razdoblje") {
        sporednaSekcija = {
            naslov: "Mjesečni prosjeci",
            opis: "Prosječne vrijednosti za svaki mjesec u odabranom razdoblju.",
            prviStupac: "Mjesec",
            redovi: grupirajPoMjesecu(osnovnaLista)
        };

        glavnaSekcija = {
            naslov: "Dnevni prosjeci",
            opis: "Prosječne dnevne vrijednosti za odabrano razdoblje.",
            prviStupac: "Datum",
            redovi: grupirajPoDanu(osnovnaLista),
            vrsta: "prosjek"
        };
    } else if (odabir.vrsta === "mjesec") {
        sporednaSekcija = {
            naslov: "Sažetak mjeseca",
            opis: "Odabrani mjesec prikazan je kroz prosjek mjeseca i dnevne prosjeke.",
            prviStupac: "Mjesec",
            redovi: [{
                oznaka: dohvatiTekstMjesecGodina(odabir.godina, odabir.mjesec),
                ...sazetak
            }]
        };

        glavnaSekcija = {
            naslov: "Dnevni prosjeci",
            opis: "Prosječne dnevne vrijednosti za odabrani mjesec.",
            prviStupac: "Datum",
            redovi: grupirajPoDanu(osnovnaLista),
            vrsta: "prosjek"
        };
    } else if (odabir.vrsta === "dan") {
        glavnaSekcija = {
            naslov: "Satna mjerenja",
            opis: "Sva dostupna mjerenja po satima za odabrani dan.",
            prviStupac: "Vrijeme",
            redovi: [...osnovnaLista].sort(usporediMjerenjaOdNajnovijeg).map((mjerenje) => ({
                oznaka: mjerenje.vrijeme,
                pm25: mjerenje.pm25,
                pm10: mjerenje.pm10,
                temperatura: mjerenje.temperatura,
                vlaga: mjerenje.vlaga,
                co2: mjerenje.co2,
                tlak: mjerenje.tlak
            })),
            vrsta: "sat"
        };
    } else if (odabir.vrsta === "interval") {
        const mjesecniRedovi = grupirajPoMjesecu(osnovnaLista);
        if (mjesecniRedovi.length > 1) {
            sporednaSekcija = {
                naslov: "Mjesečni prosjeci",
                opis: "Prosjeci po mjesecima unutar odabranog intervala.",
                prviStupac: "Mjesec",
                redovi: mjesecniRedovi
            };
        }

        glavnaSekcija = {
            naslov: "Dnevni prosjeci",
            opis: "Prosječne dnevne vrijednosti za odabrani interval.",
            prviStupac: "Datum",
            redovi: grupirajPoDanu(osnovnaLista),
            vrsta: "prosjek"
        };
    }

    const upit = pretragaTablice ? pretragaTablice.value.trim().toLowerCase() : "";

    function filtrirajRedovePoPretrazi(redovi) {
        if (!upit) return redovi;

        return redovi.filter((red) => {
            return [red.oznaka, red.pm25, red.pm10, red.temperatura, red.vlaga, red.co2, red.tlak]
                .map((vrijednost) => String(vrijednost).toLowerCase())
                .some((vrijednost) => vrijednost.includes(upit));
        });
    }

    if (sporednaSekcija) {
        sporednaSekcija.redovi = filtrirajRedovePoPretrazi(sporednaSekcija.redovi);
    }

    if (glavnaSekcija) {
        glavnaSekcija.redovi = filtrirajRedovePoPretrazi(glavnaSekcija.redovi);
    }

    return {
        odabir,
        naslov,
        opis,
        naslovSazetka,
        sazetak,
        sporednaSekcija,
        glavnaSekcija,
        osnovnaLista
    };
}

function stvoriCeliju(tekst, klasa = "") {
    const td = document.createElement("td");
    td.textContent = tekst;
    if (klasa) td.className = klasa;
    return td;
}

function popuniZaglavljeTablice(theadElement, prviStupac) {
    if (!theadElement) return;

    theadElement.innerHTML = `
        <tr>
            <th>${prviStupac}</th>
            <th>Temperatura</th>
            <th>Vlaga</th>
            <th>Tlak</th>
            <th>PM2.5</th>
            <th>PM10</th>
            <th>CO₂</th>
        </tr>
    `;
}

function popuniTablicuRedovima(tbodyElement, redovi) {
    if (!tbodyElement) return;

    tbodyElement.innerHTML = "";

    if (!redovi.length) {
        const red = document.createElement("tr");
        const celija = document.createElement("td");
        celija.colSpan = 7;
        celija.textContent = "Nema podataka za odabrani prikaz.";
        red.appendChild(celija);
        tbodyElement.appendChild(red);
        return;
    }

    redovi.forEach((redPodataka) => {
        const red = document.createElement("tr");
        red.appendChild(stvoriCeliju(redPodataka.oznaka));
        red.appendChild(stvoriCeliju(redPodataka.temperatura));
        red.appendChild(stvoriCeliju(redPodataka.vlaga));
        red.appendChild(stvoriCeliju(redPodataka.tlak));
        red.appendChild(stvoriCeliju(redPodataka.pm25, odrediKlasuPM25(redPodataka.pm25)));
        red.appendChild(stvoriCeliju(redPodataka.pm10, odrediKlasuPM10(redPodataka.pm10)));
        red.appendChild(stvoriCeliju(redPodataka.co2));
        tbodyElement.appendChild(red);
    });
}

function prikaziSazetak(prikaz) {
    if (!sazetakArhive) return;

    sazetakArhive.innerHTML = "";

    if (!prikaz.sazetak) {
        sazetakArhive.innerHTML = `<div class="panel-info-prazno">Nema podataka za odabrano razdoblje.</div>`;
        return;
    }

    const kartice = [
        { naslov: prikaz.naslovSazetka, vrijednost: `${formatirajBroj(prikaz.sazetak.temperatura)} °C`, opis: "Temperatura" },
        { naslov: prikaz.naslovSazetka, vrijednost: `${formatirajBroj(prikaz.sazetak.vlaga)} %`, opis: "Vlaga" },
        { naslov: prikaz.naslovSazetka, vrijednost: `${formatirajBroj(prikaz.sazetak.tlak)} hPa`, opis: "Tlak" },
        { naslov: prikaz.naslovSazetka, vrijednost: `${formatirajBroj(prikaz.sazetak.pm25)} µg/m³`, opis: "PM2.5" },
        { naslov: prikaz.naslovSazetka, vrijednost: `${formatirajBroj(prikaz.sazetak.pm10)} µg/m³`, opis: "PM10" },
        { naslov: prikaz.naslovSazetka, vrijednost: `${formatirajBroj(prikaz.sazetak.co2)} ppm`, opis: "CO₂" }
    ];

    kartice.forEach((stavka) => {
        const kartica = document.createElement("div");
        kartica.className = "card arhiva-kartica";
        kartica.innerHTML = `
            <span class="card-title">${stavka.opis}</span>
            <p class="card-value">${stavka.vrijednost}</p>
            <span class="card-desc">${stavka.naslov}</span>
        `;
        sazetakArhive.appendChild(kartica);
    });
}

function prikaziArhivu() {
    if (!glavnaTbody || !naslovArhive) return;

    const prikaz = pripremiPrikazArhive();

    naslovArhive.textContent = prikaz.naslov;
    if (opisArhive) opisArhive.textContent = prikaz.opis;

    prikaziSazetak(prikaz);

    if (prikaz.sporednaSekcija && prikaz.sporednaSekcija.redovi.length) {
        panelMjesecni.hidden = false;
        naslovMjesecneTablice.textContent = prikaz.sporednaSekcija.naslov;
        popuniZaglavljeTablice(mjesecniThead, prikaz.sporednaSekcija.prviStupac);
        popuniTablicuRedovima(mjesecniTbody, prikaz.sporednaSekcija.redovi);
    } else if (panelMjesecni) {
        panelMjesecni.hidden = true;
        if (mjesecniTbody) mjesecniTbody.innerHTML = "";
    }

    if (prikaz.glavnaSekcija) {
        naslovGlavneTablice.textContent = prikaz.glavnaSekcija.naslov;
        if (podnaslovGlavneTablice) podnaslovGlavneTablice.textContent = prikaz.glavnaSekcija.opis;
        popuniZaglavljeTablice(glavnaThead, prikaz.glavnaSekcija.prviStupac);
        popuniTablicuRedovima(glavnaTbody, prikaz.glavnaSekcija.redovi);
    }

    return prikaz;
}

function uskladiFilterePriOdabiruDana() {
    if (!filterDan || !filterDan.value) return;

    const godina = filterDan.value.slice(0, 4);
    const mjesec = String(Number(filterDan.value.slice(5, 7)));

    if (filterGodina) filterGodina.value = godina;
    if (filterMjesec) filterMjesec.value = mjesec;
    if (filterOd) filterOd.value = "";
    if (filterDo) filterDo.value = "";
}

function uskladiFilterePriOdabiruIntervala() {
    if (filterDan) filterDan.value = "";
}

function resetirajFiltereArhive() {
    if (filterGodina) filterGodina.value = "";
    if (filterMjesec) filterMjesec.value = "";
    if (filterDan) filterDan.value = "";
    if (filterOd) filterOd.value = "";
    if (filterDo) filterDo.value = "";
    if (pretragaTablice) pretragaTablice.value = "";
    prikaziArhivu();
}

function inicijalizirajArhivu() {
    if (!glavnaTbody) return;

    popuniGodine();
    postaviRasponDatumskihFiltera();
    prikaziArhivu();

    if (preuzmiExcelGumb) {
        preuzmiExcelGumb.textContent = "Preuzmi Excel";
    }

    if (filterGodina) {
        filterGodina.addEventListener("change", prikaziArhivu);
    }

    if (filterMjesec) {
        filterMjesec.addEventListener("change", prikaziArhivu);
    }

    if (filterDan) {
        filterDan.addEventListener("change", () => {
            uskladiFilterePriOdabiruDana();
            prikaziArhivu();
        });
    }

    if (filterOd) {
        filterOd.addEventListener("change", () => {
            uskladiFilterePriOdabiruIntervala();
            prikaziArhivu();
        });
    }

    if (filterDo) {
        filterDo.addEventListener("change", () => {
            uskladiFilterePriOdabiruIntervala();
            prikaziArhivu();
        });
    }

    if (pretragaTablice) {
        pretragaTablice.addEventListener("input", prikaziArhivu);
    }

    if (resetFilteraGumb) {
        resetFilteraGumb.addEventListener("click", resetirajFiltereArhive);
    }
}

/* Excel izvoz */
function postaviObrubICentar(celija, boja = "FFBFBFBF") {
    celija.alignment = { horizontal: "center", vertical: "middle" };
    celija.border = {
        top: { style: "thin", color: { argb: boja } },
        left: { style: "thin", color: { argb: boja } },
        bottom: { style: "thin", color: { argb: boja } },
        right: { style: "thin", color: { argb: boja } }
    };
}

function dodajNaslovSekcije(worksheet, tekst, brojStupaca) {
    const red = worksheet.addRow([tekst]);
    worksheet.mergeCells(red.number, 1, red.number, brojStupaca);
    const celija = worksheet.getCell(red.number, 1);
    celija.font = { bold: true, size: 13, color: { argb: "FF1F1F1F" } };
    celija.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9EAF7" } };
    celija.alignment = { horizontal: "left", vertical: "middle" };
    celija.border = {
        top: { style: "thin", color: { argb: "FFA6A6A6" } },
        left: { style: "thin", color: { argb: "FFA6A6A6" } },
        bottom: { style: "thin", color: { argb: "FFA6A6A6" } },
        right: { style: "thin", color: { argb: "FFA6A6A6" } }
    };
    return red.number;
}

function stilizirajGlavniNaslovExcela(worksheet, naslov, opis, brojStupaca) {
    worksheet.addRow([naslov]);
    worksheet.mergeCells(1, 1, 1, brojStupaca);
    const naslovCelija = worksheet.getCell(1, 1);
    naslovCelija.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
    naslovCelija.alignment = { horizontal: "center", vertical: "middle" };
    naslovCelija.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
    worksheet.getRow(1).height = 26;

    worksheet.addRow([opis]);
    worksheet.mergeCells(2, 1, 2, brojStupaca);
    const opisCelija = worksheet.getCell(2, 1);
    opisCelija.font = { italic: true, color: { argb: "FF475569" } };
    opisCelija.alignment = { horizontal: "left", vertical: "middle" };

    worksheet.addRow([]);
}

function dodajTablicuProsjeka(worksheet, naziv, prviStupac, redovi) {
    if (!redovi || !redovi.length) return;

    dodajNaslovSekcije(worksheet, naziv, 7);
    const zaglavlje = worksheet.addRow([prviStupac, "Temperatura", "Vlaga", "Tlak", "PM2.5", "PM10", "CO₂"]);
    zaglavlje.eachCell((celija) => {
        celija.font = { bold: true, color: { argb: "FFFFFFFF" } };
        celija.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4472C4" } };
        postaviObrubICentar(celija);
    });

    redovi.forEach((red) => {
        const excelRed = worksheet.addRow([red.oznaka, red.temperatura, red.vlaga, red.tlak, red.pm25, red.pm10, red.co2]);
        excelRed.eachCell((celija, indeks) => {
            postaviObrubICentar(celija);
            if (indeks === 1) {
                celija.alignment = { horizontal: "left", vertical: "middle" };
            }
            if (indeks > 1) {
                celija.numFmt = "0.0";
            }
        });
        obojiExcelPMCelije(excelRed);
    });

    worksheet.addRow([]);
}

function dodajTablicuSatnihMjerenja(worksheet, naziv, redovi) {
    if (!redovi || !redovi.length) return;

    dodajNaslovSekcije(worksheet, naziv, 7);
    const zaglavlje = worksheet.addRow(["Vrijeme", "Temperatura", "Vlaga", "Tlak", "PM2.5", "PM10", "CO₂"]);
    zaglavlje.eachCell((celija) => {
        celija.font = { bold: true, color: { argb: "FFFFFFFF" } };
        celija.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4472C4" } };
        postaviObrubICentar(celija);
    });

    redovi.forEach((red) => {
        const excelRed = worksheet.addRow([red.oznaka, red.temperatura, red.vlaga, red.tlak, red.pm25, red.pm10, red.co2]);
        excelRed.eachCell((celija, indeks) => {
            postaviObrubICentar(celija);
            if (indeks === 1) {
                celija.alignment = { horizontal: "left", vertical: "middle" };
            } else {
                celija.numFmt = "0";
            }
        });
        obojiExcelPMCelije(excelRed);
    });

    worksheet.addRow([]);
}

function dodajSazetakUExcel(worksheet, naslov, sazetak) {
    if (!sazetak) return;

    dodajNaslovSekcije(worksheet, naslov, 7);
    const zaglavlje = worksheet.addRow(["Vrsta", "Temperatura", "Vlaga", "Tlak", "PM2.5", "PM10", "CO₂"]);
    zaglavlje.eachCell((celija) => {
        celija.font = { bold: true, color: { argb: "FFFFFFFF" } };
        celija.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4472C4" } };
        postaviObrubICentar(celija);
    });

    const red = worksheet.addRow([naslov, sazetak.temperatura, sazetak.vlaga, sazetak.tlak, sazetak.pm25, sazetak.pm10, sazetak.co2]);
    red.eachCell((celija, indeks) => {
        postaviObrubICentar(celija);
        if (indeks === 1) {
            celija.alignment = { horizontal: "left", vertical: "middle" };
        } else {
            celija.numFmt = "0.0";
        }
    });
    obojiExcelPMCelije(red);

    worksheet.addRow([]);
}

function obojiExcelPMCelije(red) {
    const pm25 = Number(red.getCell(5).value);
    const pm10 = Number(red.getCell(6).value);

    if (!Number.isNaN(pm25)) {
        if (pm25 <= 15) {
            red.getCell(5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2F0D9" } };
        } else if (pm25 <= 35) {
            red.getCell(5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
        } else {
            red.getCell(5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4CCCC" } };
        }
    }

    if (!Number.isNaN(pm10)) {
        if (pm10 <= 25) {
            red.getCell(6).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2F0D9" } };
        } else if (pm10 <= 50) {
            red.getCell(6).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
        } else {
            red.getCell(6).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4CCCC" } };
        }
    }
}

function preuzmiExcelDatoteku() {
    if (typeof ExcelJS === "undefined") {
        alert("ExcelJS biblioteka nije učitana.");
        return;
    }

    const prikaz = pripremiPrikazArhive();

    if (!prikaz.osnovnaLista.length) {
        alert("Nema podataka za izvoz.");
        return;
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Arhiva mjerenja");

    stilizirajGlavniNaslovExcela(worksheet, prikaz.naslov, prikaz.opis, 7);
    dodajSazetakUExcel(worksheet, prikaz.naslovSazetka, prikaz.sazetak);

    if (prikaz.sporednaSekcija && prikaz.sporednaSekcija.redovi.length) {
        dodajTablicuProsjeka(
            worksheet,
            prikaz.sporednaSekcija.naslov,
            prikaz.sporednaSekcija.prviStupac,
            prikaz.sporednaSekcija.redovi
        );
    }

    if (prikaz.glavnaSekcija) {
        if (prikaz.glavnaSekcija.vrsta === "sat") {
            dodajTablicuSatnihMjerenja(worksheet, prikaz.glavnaSekcija.naslov, prikaz.glavnaSekcija.redovi);
        } else {
            dodajTablicuProsjeka(
                worksheet,
                prikaz.glavnaSekcija.naslov,
                prikaz.glavnaSekcija.prviStupac,
                prikaz.glavnaSekcija.redovi
            );
        }
    }

    worksheet.getColumn(1).width = 24;
    worksheet.getColumn(2).width = 12;
    worksheet.getColumn(3).width = 12;
    worksheet.getColumn(4).width = 16;
    worksheet.getColumn(5).width = 12;
    worksheet.getColumn(6).width = 12;
    worksheet.getColumn(7).width = 12;

    worksheet.views = [{ state: "frozen", ySplit: 1 }];

    let nazivDatoteke = "arhiva_kvalitete_zraka.xlsx";
    if (prikaz.odabir.vrsta === "godina") {
        nazivDatoteke = `arhiva_${prikaz.odabir.godina}.xlsx`;
    } else if (prikaz.odabir.vrsta === "mjesec") {
        nazivDatoteke = `arhiva_${prikaz.odabir.godina}_${prikaz.odabir.mjesec}.xlsx`;
    } else if (prikaz.odabir.vrsta === "dan") {
        nazivDatoteke = `arhiva_${prikaz.odabir.datum}.xlsx`;
    } else if (prikaz.odabir.vrsta === "interval") {
        nazivDatoteke = `arhiva_${prikaz.odabir.od}_${prikaz.odabir.do}.xlsx`;
    }

    workbook.xlsx.writeBuffer().then((buffer) => {
        const blob = new Blob([buffer], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        });

        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.href = url;
        link.download = nazivDatoteke;
        link.click();
        URL.revokeObjectURL(url);
    });
}

inicijalizirajArhivu();

if (preuzmiExcelGumb) {
    preuzmiExcelGumb.addEventListener("click", function () {
        preuzmiExcelDatoteku();
    });
}

/* Zadnjih 48 sati - stvarna mjerenja */
function dohvatiVrijemeMjerenja(mjerenje) {
    if (mjerenje.received_at_utc) {
        const vrijemeIzBaze = new Date(mjerenje.received_at_utc);
        if (!Number.isNaN(vrijemeIzBaze.getTime())) {
            return vrijemeIzBaze;
        }
    }

    const lokalnoVrijeme = new Date(`${mjerenje.datum}T${mjerenje.vrijeme}:00`);
    if (!Number.isNaN(lokalnoVrijeme.getTime())) {
        return lokalnoVrijeme;
    }

    return null;
}

function formatirajOznakuMjerenja(mjerenje) {
    const vrijeme = dohvatiVrijemeMjerenja(mjerenje);
    if (!vrijeme) return mjerenje.vrijeme || "--";

    const dijelovi = new Intl.DateTimeFormat("hr-HR", {
        timeZone: VREMENSKA_ZONA,
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    }).formatToParts(vrijeme);

    const vrijednosti = {};
    dijelovi.forEach((dio) => {
        if (dio.type !== "literal") vrijednosti[dio.type] = dio.value;
    });

    return `${vrijednosti.day}.${vrijednosti.month}. ${vrijednosti.hour}:${vrijednosti.minute}`;
}

function generirajPodatkeZaZadnjih48Sati() {
    if (!Array.isArray(povijestMjerenja) || povijestMjerenja.length === 0) {
        return [];
    }

    const sada = new Date();
    const pocetak = new Date(sada.getTime() - 48 * 60 * 60 * 1000);

    return [...povijestMjerenja]
        .map((mjerenje) => ({
            ...mjerenje,
            vrijemeMjerenja: dohvatiVrijemeMjerenja(mjerenje)
        }))
        .filter((mjerenje) => {
            return mjerenje.vrijemeMjerenja &&
                mjerenje.vrijemeMjerenja >= pocetak &&
                mjerenje.vrijemeMjerenja <= sada;
        })
        .sort((a, b) => b.vrijemeMjerenja - a.vrijemeMjerenja)
        .map((mjerenje) => ({
            sat: formatirajOznakuMjerenja(mjerenje),
            pm25: mjerenje.pm25,
            pm10: mjerenje.pm10,
            temperatura: mjerenje.temperatura,
            vlaga: mjerenje.vlaga,
            co2: mjerenje.co2,
            tlak: mjerenje.tlak
        }));
}

/* Tablica zadnjih 48 sati na početnoj */
const tablicaZadnja24hBody = document.getElementById("tablica-zadnja-24h-body");

function popuniTablicuZadnja24h() {
    if (!tablicaZadnja24hBody) return;

    const podaci48h = generirajPodatkeZaZadnjih48Sati();
    tablicaZadnja24hBody.innerHTML = "";

    if (!podaci48h.length) {
        const red = document.createElement("tr");
        red.innerHTML = `<td colspan="7">Nema mjerenja u zadnjih 48 sati.</td>`;
        tablicaZadnja24hBody.appendChild(red);
        return;
    }

    podaci48h.forEach((mjerenje) => {
        const red = document.createElement("tr");

        const klasaPM25 = odrediKlasuPM25(mjerenje.pm25);
        const klasaPM10 = odrediKlasuPM10(mjerenje.pm10);

        red.innerHTML = `
            <td>${mjerenje.sat}</td>
            <td>${mjerenje.temperatura}</td>
            <td>${mjerenje.vlaga}</td>
            <td>${mjerenje.tlak}</td>
            <td class="${klasaPM25}">${mjerenje.pm25}</td>
            <td class="${klasaPM10}">${mjerenje.pm10}</td>
            <td>${mjerenje.co2}</td>
        `;

        tablicaZadnja24hBody.appendChild(red);
    });
}

popuniTablicuZadnja24h();

/* Graf na početnoj - zadnjih 48 sati */
const odabirPodatka = document.getElementById("odabir-podatka");
const chartCanvas = document.getElementById("airChart");

if (chartCanvas && odabirPodatka && typeof Chart !== "undefined") {
    odabirPodatka.value = "temperatura";
    const podaci48h = generirajPodatkeZaZadnjih48Sati();
    const podaci48hZaGraf = [...podaci48h].reverse();
    const oznakeVremena = podaci48hZaGraf.map(m => m.sat);

    const podaci48Sati = {
        temperatura: {
            label: "Temperatura",
            vrijednosti: podaci48hZaGraf.map(m => m.temperatura)
        },
        vlaga: {
            label: "Vlaga",
            vrijednosti: podaci48hZaGraf.map(m => m.vlaga)
        },
        tlak: {
            label: "Tlak",
            vrijednosti: podaci48hZaGraf.map(m => m.tlak)
        },
        pm25: {
            label: "PM2.5",
            vrijednosti: podaci48hZaGraf.map(m => m.pm25)
        },
        pm10: {
            label: "PM10",
            vrijednosti: podaci48hZaGraf.map(m => m.pm10)
        },
        co2: {
            label: "CO₂",
            vrijednosti: podaci48hZaGraf.map(m => m.co2)
        }
    };

    const ctx = chartCanvas.getContext("2d");

    let airChart = new Chart(ctx, {
        type: "line",
        data: {
            labels: oznakeVremena,
            datasets: [
                {
                    label: podaci48Sati.temperatura.label,
                    data: podaci48Sati.temperatura.vrijednosti,
                    borderColor: "#2563eb",
                    backgroundColor: "rgba(37, 99, 235, 0.12)",
                    tension: 0.35,
                    fill: true,
                    pointRadius: 3,
                    pointHoverRadius: 5
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: "top" }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: "Vrijednost"
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: "Zadnjih 48 sati"
                    }
                }
            }
        }
    });

    odabirPodatka.addEventListener("change", function () {
        const odabrano = podaci48Sati[this.value];
        airChart.data.datasets[0].label = odabrano.label;
        airChart.data.datasets[0].data = odabrano.vrijednosti;
        airChart.update();
    });
}

/* Karta i upravljanje lokacijama - lokacije su spremljene u bazi */
const mapaElement = document.getElementById("mapa");
const odabirLokacije = document.getElementById("odabir-lokacije");
const obrisiLokacijuBtn = document.getElementById("obrisi-lokaciju");
const lokacijaForma = document.getElementById("lokacija-forma");
const lokacijaNazivInput = document.getElementById("lokacija-naziv");
const lokacijaLatInput = document.getElementById("lokacija-lat");
const lokacijaLonInput = document.getElementById("lokacija-lon");
const lokacijaOpisInput = document.getElementById("lokacija-opis");
const nazivLokacijePrikaz = document.getElementById("naziv-lokacije-prikaz");
const opisLokacijePrikaz = document.getElementById("opis-lokacije-prikaz");
const koordinatePrikaz = document.getElementById("koordinate-prikaz");
const lokacijaPoruka = document.getElementById("lokacija-poruka");

let pkzLokacije = [];
let aktivnaLokacijaId = "";
let mapa;
let markerLokacije;

function prikaziPorukuLokacije(tekst) {
    if (!lokacijaPoruka) return;

    lokacijaPoruka.textContent = tekst;
    clearTimeout(prikaziPorukuLokacije.timer);
    prikaziPorukuLokacije.timer = setTimeout(() => {
        lokacijaPoruka.textContent = "";
    }, 3000);
}

function popuniOdabirLokacije() {
    if (!odabirLokacije) return;

    odabirLokacije.innerHTML = "";

    pkzLokacije.forEach((lokacija) => {
        const option = document.createElement("option");
        option.value = lokacija.id;
        option.textContent = lokacija.naziv;
        odabirLokacije.appendChild(option);
    });

    odabirLokacije.value = aktivnaLokacijaId;
}

function dohvatiAktivnuLokaciju() {
    return pkzLokacije.find((lokacija) => lokacija.id === aktivnaLokacijaId) || pkzLokacije[0] || aktivnaLokacijaServer;
}

function azurirajPrikazLokacije() {
    const lokacija = dohvatiAktivnuLokaciju();
    if (!lokacija) return;

    pkzAzurirajPrikazAktivneLokacije(lokacija);

    if (nazivLokacijePrikaz) nazivLokacijePrikaz.textContent = lokacija.naziv;
    if (opisLokacijePrikaz) opisLokacijePrikaz.textContent = lokacija.opis || "Bez opisa";
    if (koordinatePrikaz) {
        koordinatePrikaz.textContent = `${formatirajKoordinatu(lokacija.lat)}, ${formatirajKoordinatu(lokacija.lon)}`;
    }

    if (mapa && markerLokacije) {
        const pozicija = [Number(lokacija.lat), Number(lokacija.lon)];
        markerLokacije.setLatLng(pozicija);
        markerLokacije.bindPopup(`<b>${lokacija.naziv}</b><br>${lokacija.opis || "Senzorski čvor"}`);
        mapa.setView(pozicija, 13);
        markerLokacije.openPopup();
    }
}

function inicijalizirajMapuAkoTreba() {
    if (!mapaElement || typeof L === "undefined" || mapa) return;

    const pocetnaLokacija = dohvatiAktivnuLokaciju();
    if (!pocetnaLokacija) return;

    const pocetnaPozicija = [Number(pocetnaLokacija.lat), Number(pocetnaLokacija.lon)];

    mapa = L.map("mapa", {
        scrollWheelZoom: false
    }).setView(pocetnaPozicija, 13);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap"
    }).addTo(mapa);

    markerLokacije = L.marker(pocetnaPozicija)
        .addTo(mapa)
        .bindPopup(`<b>${pocetnaLokacija.naziv}</b><br>${pocetnaLokacija.opis || "Senzorski čvor"}`)
        .openPopup();

    const uputaKarte = document.createElement("div");
    uputaKarte.className = "mapa-uputa";
    uputaKarte.textContent = "Za zumiranje karte drži Ctrl i koristi kotačić miša";
    mapaElement.appendChild(uputaKarte);

    let timerUpute;

    function prikaziUputuKarte() {
        uputaKarte.classList.add("prikazi");
        clearTimeout(timerUpute);
        timerUpute = setTimeout(() => {
            uputaKarte.classList.remove("prikazi");
        }, 1800);
    }

    mapaElement.addEventListener("mouseenter", prikaziUputuKarte);

    mapaElement.addEventListener("wheel", function (event) {
        if (!event.ctrlKey) {
            prikaziUputuKarte();
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const trenutniZoom = mapa.getZoom();
        const promjenaZooma = event.deltaY < 0 ? 1 : -1;
        const noviZoom = Math.max(mapa.getMinZoom(), Math.min(mapa.getMaxZoom(), trenutniZoom + promjenaZooma));

        if (noviZoom === trenutniZoom) return;

        const tockaKontejnera = mapa.mouseEventToContainerPoint(event);
        mapa.setZoomAround(tockaKontejnera, noviZoom);
    }, { passive: false });
}

function ucitajLokacijeIzBaze() {
    if (!odabirLokacije && !mapaElement) return;

    fetch("/api/locations?ts=" + Date.now(), { cache: "no-store" })
        .then((odgovor) => odgovor.json())
        .then((podaci) => {
            pkzLokacije = Array.isArray(podaci.locations) ? podaci.locations : [];
            aktivnaLokacijaId = podaci.active_location_id || (pkzLokacije[0] ? pkzLokacije[0].id : "");

            popuniOdabirLokacije();
            inicijalizirajMapuAkoTreba();
            azurirajPrikazLokacije();
        })
        .catch(() => {
            pkzLokacije = aktivnaLokacijaServer ? [aktivnaLokacijaServer] : [];
            aktivnaLokacijaId = aktivnaLokacijaServer ? aktivnaLokacijaServer.id : "";

            popuniOdabirLokacije();
            inicijalizirajMapuAkoTreba();
            azurirajPrikazLokacije();
            prikaziPorukuLokacije("Lokacije trenutno nisu dostupne.");
        });
}

function postaviAktivnuLokaciju(locationId) {
    return fetch("/api/locations/active", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ location_id: locationId })
    }).then((odgovor) => {
        if (!odgovor.ok) throw new Error("Lokacija nije spremljena.");
        return odgovor.json();
    });
}

if (odabirLokacije) {
    odabirLokacije.addEventListener("change", function () {
        aktivnaLokacijaId = this.value;

        postaviAktivnuLokaciju(aktivnaLokacijaId)
            .then((podaci) => {
                pkzLokacije = Array.isArray(podaci.locations) ? podaci.locations : pkzLokacije;
                popuniOdabirLokacije();
                azurirajPrikazLokacije();
                prikaziPorukuLokacije("Aktivna lokacija je promijenjena. Nova mjerenja spremat će se pod ovu lokaciju.");
            })
            .catch(() => {
                prikaziPorukuLokacije("Lokacija nije promijenjena.");
            });
    });
}

if (lokacijaForma) {
    lokacijaForma.addEventListener("submit", function (event) {
        event.preventDefault();

        const naziv = lokacijaNazivInput.value.trim();
        const lat = Number(lokacijaLatInput.value);
        const lon = Number(lokacijaLonInput.value);
        const opis = lokacijaOpisInput.value.trim();

        if (!naziv || Number.isNaN(lat) || Number.isNaN(lon)) {
            prikaziPorukuLokacije("Unesi naziv i ispravne koordinate.");
            return;
        }

        fetch("/api/locations", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ naziv, opis, lat, lon })
        })
            .then((odgovor) => {
                if (!odgovor.ok) throw new Error("Lokacija nije spremljena.");
                return odgovor.json();
            })
            .then((podaci) => {
                pkzLokacije = Array.isArray(podaci.locations) ? podaci.locations : pkzLokacije;
                aktivnaLokacijaId = podaci.location ? podaci.location.id : aktivnaLokacijaId;
                popuniOdabirLokacije();
                azurirajPrikazLokacije();
                lokacijaForma.reset();
                prikaziPorukuLokacije("Lokacija je spremljena i postavljena kao aktivna.");
            })
            .catch(() => {
                prikaziPorukuLokacije("Lokacija nije spremljena.");
            });
    });
}

if (obrisiLokacijuBtn) {
    obrisiLokacijuBtn.addEventListener("click", function () {
        if (!aktivnaLokacijaId) return;

        if (!confirm("Izbrisati aktivnu lokaciju i mjerenja povezana s njom?")) {
            return;
        }

        fetch(`/api/locations/${encodeURIComponent(aktivnaLokacijaId)}`, {
            method: "DELETE"
        })
            .then((odgovor) => {
                if (!odgovor.ok) throw new Error("Lokacija se ne može izbrisati.");
                return odgovor.json();
            })
            .then((podaci) => {
                pkzLokacije = Array.isArray(podaci.locations) ? podaci.locations : pkzLokacije;
                const aktivna = pkzLokacije.find((lokacija) => lokacija.active) || pkzLokacije[0];
                aktivnaLokacijaId = aktivna ? aktivna.id : "";
                popuniOdabirLokacije();
                azurirajPrikazLokacije();
                prikaziPorukuLokacije("Lokacija je izbrisana.");
            })
            .catch(() => {
                prikaziPorukuLokacije("Lokacija nije izbrisana. Mora ostati barem jedna lokacija.");
            });
    });
}

ucitajLokacijeIzBaze();

/* Jednostavna arhiva s osnovnim filterom */
const jednostavnaArhivaBody = document.getElementById("jednostavna-arhiva-body");
const jednostavnaArhivaOpis = document.getElementById("jednostavna-arhiva-opis");
const jednostavnaArhivaMjesec = document.getElementById("jednostavna-arhiva-mjesec");
const jednostavniFilterGumbi = document.querySelectorAll("[data-jednostavni-filter]");

let aktivniJednostavniFilter = "24h";

function pretvoriMjerenjeUDatum(mjerenje) {
    return new Date(`${mjerenje.datum}T${mjerenje.vrijeme}:00`);
}

function popuniOdabirMjeseca() {
    if (!jednostavnaArhivaMjesec) return;

    const mjeseci = [...new Set(povijestMjerenja.map((mjerenje) => mjerenje.datum.slice(0, 7)))].sort().reverse();

    mjeseci.forEach((mjesec) => {
        const opcija = document.createElement("option");
        const godina = mjesec.slice(0, 4);
        const brojMjeseca = Number(mjesec.slice(5, 7));

        opcija.value = mjesec;
        opcija.textContent = `${dohvatiNazivMjeseca(brojMjeseca)} ${godina}.`;
        jednostavnaArhivaMjesec.appendChild(opcija);
    });
}

function filtrirajJednostavnuArhivu() {
    let mjerenja = [...povijestMjerenja];

    if (jednostavnaArhivaMjesec && jednostavnaArhivaMjesec.value) {
        const odabraniMjesec = jednostavnaArhivaMjesec.value;
        return mjerenja.filter((mjerenje) => mjerenje.datum.startsWith(odabraniMjesec));
    }

    if (aktivniJednostavniFilter === "all") {
        return mjerenja;
    }

    const zadnjeMjerenjeArhive = povijestMjerenja[0];
    if (!zadnjeMjerenjeArhive) return [];

    const zadnjiDatum = pretvoriMjerenjeUDatum(zadnjeMjerenjeArhive);
    const pocetak = new Date(zadnjiDatum);

    if (aktivniJednostavniFilter === "24h") {
        pocetak.setHours(pocetak.getHours() - 24);
    } else if (aktivniJednostavniFilter === "7d") {
        pocetak.setDate(pocetak.getDate() - 7);
    } else if (aktivniJednostavniFilter === "30d") {
        pocetak.setDate(pocetak.getDate() - 30);
    }

    return mjerenja.filter((mjerenje) => pretvoriMjerenjeUDatum(mjerenje) >= pocetak);
}

function dohvatiOpisJednostavneArhive(brojMjerenja) {
    if (jednostavnaArhivaMjesec && jednostavnaArhivaMjesec.value) {
        const godina = jednostavnaArhivaMjesec.value.slice(0, 4);
        const mjesec = Number(jednostavnaArhivaMjesec.value.slice(5, 7));
        return `Prikazuje se ${brojMjerenja} mjerenja za ${dohvatiNazivMjeseca(mjesec)} ${godina}.`;
    }

    if (aktivniJednostavniFilter === "24h") {
        return `Prikazuje se ${brojMjerenja} mjerenja za zadnja 24 sata.`;
    }

    if (aktivniJednostavniFilter === "7d") {
        return `Prikazuje se ${brojMjerenja} mjerenja za zadnjih 7 dana.`;
    }

    if (aktivniJednostavniFilter === "30d") {
        return `Prikazuje se ${brojMjerenja} mjerenja za zadnjih 30 dana.`;
    }

    return `Prikazuje se ukupno ${brojMjerenja} spremljenih mjerenja.`;
}

function popuniJednostavnuArhivu() {
    if (!jednostavnaArhivaBody) return;

    jednostavnaArhivaBody.innerHTML = "";

    const mjerenjaZaPrikaz = filtrirajJednostavnuArhivu();

    if (jednostavnaArhivaOpis) {
        jednostavnaArhivaOpis.textContent = dohvatiOpisJednostavneArhive(mjerenjaZaPrikaz.length);
    }

    if (mjerenjaZaPrikaz.length === 0) {
        const red = document.createElement("tr");
        red.innerHTML = `<td colspan="8">Nema spremljenih mjerenja za odabrano razdoblje.</td>`;
        jednostavnaArhivaBody.appendChild(red);
        return;
    }

    mjerenjaZaPrikaz.forEach((mjerenje) => {
        const red = document.createElement("tr");

        red.innerHTML = `
            <td>${formatirajDatumHR(mjerenje.datum)}</td>
            <td>${mjerenje.vrijeme}</td>
            <td>${mjerenje.temperatura} °C</td>
            <td>${mjerenje.vlaga} %</td>
            <td>${mjerenje.tlak} hPa</td>
            <td class="${odrediKlasuPM25(mjerenje.pm25)}">${mjerenje.pm25} µg/m³</td>
            <td class="${odrediKlasuPM10(mjerenje.pm10)}">${mjerenje.pm10} µg/m³</td>
            <td>${mjerenje.co2} ppm</td>
        `;

        jednostavnaArhivaBody.appendChild(red);
    });
}

if (jednostavnaArhivaBody) {
    popuniOdabirMjeseca();

    jednostavniFilterGumbi.forEach((gumb) => {
        gumb.addEventListener("click", () => {
            aktivniJednostavniFilter = gumb.dataset.jednostavniFilter;

            jednostavniFilterGumbi.forEach((element) => element.classList.remove("aktivan"));
            gumb.classList.add("aktivan");

            if (jednostavnaArhivaMjesec) {
                jednostavnaArhivaMjesec.value = "";
            }

            popuniJednostavnuArhivu();
        });
    });

    if (jednostavnaArhivaMjesec) {
        jednostavnaArhivaMjesec.addEventListener("change", () => {
            if (jednostavnaArhivaMjesec.value) {
                jednostavniFilterGumbi.forEach((element) => element.classList.remove("aktivan"));
            } else {
                aktivniJednostavniFilter = "24h";
                jednostavniFilterGumbi.forEach((element) => {
                    element.classList.toggle("aktivan", element.dataset.jednostavniFilter === "24h");
                });
            }

            popuniJednostavnuArhivu();
        });
    }

    popuniJednostavnuArhivu();
}

/* Statistika */
const statistikaMjesecSelect = document.getElementById("statistika-mjesec");
const statistikaGodinaSelect = document.getElementById("statistika-godina");
const statistikaMjesecParametar = document.getElementById("statistika-mjesec-parametar");
const statistikaGodinaParametar = document.getElementById("statistika-godina-parametar");
const mjesecniProsjekCanvas = document.getElementById("mjesecniProsjekChart");
const godisnjiProsjekCanvas = document.getElementById("godisnjiProsjekChart");
const mjesecniStatistikaOpis = document.getElementById("mjesecni-statistika-opis");
const godisnjiStatistikaOpis = document.getElementById("godisnji-statistika-opis");

const statistikaParametri = {
    temperatura: { naziv: "Temperatura", jedinica: "°C" },
    vlaga: { naziv: "Vlaga", jedinica: "%" },
    tlak: { naziv: "Tlak", jedinica: "hPa" },
    pm25: { naziv: "PM2.5", jedinica: "µg/m³" },
    pm10: { naziv: "PM10", jedinica: "µg/m³" },
    co2: { naziv: "CO₂", jedinica: "ppm" }
};

let mjesecniProsjekChart = null;
let godisnjiProsjekChart = null;

function popuniStatistikaSelecte() {
    if (statistikaMjesecSelect) {
        statistikaMjesecSelect.innerHTML = "";
        const mjeseci = [...new Set(povijestMjerenja.map((mjerenje) => mjerenje.datum.slice(0, 7)))].sort().reverse();

        mjeseci.forEach((mjesec) => {
            const opcija = document.createElement("option");
            const godina = mjesec.slice(0, 4);
            const brojMjeseca = Number(mjesec.slice(5, 7));
            opcija.value = mjesec;
            opcija.textContent = `${dohvatiNazivMjeseca(brojMjeseca)} ${godina}.`;
            statistikaMjesecSelect.appendChild(opcija);
        });
    }

    if (statistikaGodinaSelect) {
        statistikaGodinaSelect.innerHTML = "";
        const godine = [...new Set(povijestMjerenja.map((mjerenje) => mjerenje.datum.slice(0, 4)))].sort().reverse();

        godine.forEach((godina) => {
            const opcija = document.createElement("option");
            opcija.value = godina;
            opcija.textContent = godina;
            statistikaGodinaSelect.appendChild(opcija);
        });
    }
}

function stvoriIliAzurirajStatistikaGraf(canvas, postojeciGraf, oznake, vrijednosti, naslov, jedinica) {
    if (!canvas || typeof Chart === "undefined") return null;

    const podaci = {
        labels: oznake,
        datasets: [
            {
                label: `${naslov} (${jedinica})`,
                data: vrijednosti,
                borderColor: "#2563eb",
                backgroundColor: "rgba(37, 99, 235, 0.12)",
                tension: 0.35,
                fill: true,
                pointRadius: 3,
                pointHoverRadius: 5
            }
        ]
    };

    if (postojeciGraf) {
        postojeciGraf.data = podaci;
        postojeciGraf.options.scales.y.title.text = jedinica;
        postojeciGraf.update();
        return postojeciGraf;
    }

    return new Chart(canvas.getContext("2d"), {
        type: "line",
        data: podaci,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: "top" }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    title: {
                        display: true,
                        text: jedinica
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: "Razdoblje"
                    }
                }
            }
        }
    });
}

function prikaziMjesecnuStatistiku() {
    if (!statistikaMjesecSelect || !mjesecniProsjekCanvas) return;

    const odabraniMjesec = statistikaMjesecSelect.value;
    const odabraniParametar = statistikaMjesecParametar ? statistikaMjesecParametar.value : "pm25";
    const parametar = statistikaParametri[odabraniParametar];

    const mjerenjaMjeseca = povijestMjerenja.filter((mjerenje) => mjerenje.datum.startsWith(odabraniMjesec));
    const dnevniProsjeci = grupirajPoDanu(mjerenjaMjeseca).sort((a, b) => a.datum.localeCompare(b.datum));

    const oznake = dnevniProsjeci.map((red) => formatirajDatumHR(red.datum));
    const vrijednosti = dnevniProsjeci.map((red) => red[odabraniParametar]);

    mjesecniProsjekChart = stvoriIliAzurirajStatistikaGraf(
        mjesecniProsjekCanvas,
        mjesecniProsjekChart,
        oznake,
        vrijednosti,
        parametar.naziv,
        parametar.jedinica
    );

    if (mjesecniStatistikaOpis) {
        const godina = odabraniMjesec.slice(0, 4);
        const mjesec = Number(odabraniMjesec.slice(5, 7));
        mjesecniStatistikaOpis.textContent = `Prikazan je dnevni prosjek za ${parametar.naziv} u mjesecu ${dohvatiNazivMjeseca(mjesec)} ${godina}.`;
    }
}

function prikaziGodisnjuStatistiku() {
    if (!statistikaGodinaSelect || !godisnjiProsjekCanvas) return;

    const odabranaGodina = statistikaGodinaSelect.value;
    const odabraniParametar = statistikaGodinaParametar ? statistikaGodinaParametar.value : "pm25";
    const parametar = statistikaParametri[odabraniParametar];

    const mjerenjaGodine = povijestMjerenja.filter((mjerenje) => mjerenje.datum.startsWith(odabranaGodina));
    const mjesecniProsjeci = grupirajPoMjesecu(mjerenjaGodine).sort((a, b) => a.mjesecKljuc.localeCompare(b.mjesecKljuc));

    const oznake = mjesecniProsjeci.map((red) => red.oznaka.replace(`${odabranaGodina}.`, "").trim());
    const vrijednosti = mjesecniProsjeci.map((red) => red[odabraniParametar]);

    godisnjiProsjekChart = stvoriIliAzurirajStatistikaGraf(
        godisnjiProsjekCanvas,
        godisnjiProsjekChart,
        oznake,
        vrijednosti,
        parametar.naziv,
        parametar.jedinica
    );

    if (godisnjiStatistikaOpis) {
        godisnjiStatistikaOpis.textContent = `Prikazan je mjesečni prosjek za ${parametar.naziv} u ${odabranaGodina}. godini.`;
    }
}

function inicijalizirajStatistiku() {
    if (!mjesecniProsjekCanvas && !godisnjiProsjekCanvas) return;

    popuniStatistikaSelecte();
    prikaziMjesecnuStatistiku();
    prikaziGodisnjuStatistiku();

    if (statistikaMjesecSelect) statistikaMjesecSelect.addEventListener("change", prikaziMjesecnuStatistiku);
    if (statistikaMjesecParametar) statistikaMjesecParametar.addEventListener("change", prikaziMjesecnuStatistiku);
    if (statistikaGodinaSelect) statistikaGodinaSelect.addEventListener("change", prikaziGodisnjuStatistiku);
    if (statistikaGodinaParametar) statistikaGodinaParametar.addEventListener("change", prikaziGodisnjuStatistiku);
}

inicijalizirajStatistiku();


/* Dinamički status sustava - provjera stvarnog zadnjeg TTN mjerenja */
const PKZ_INTERVAL_MJERENJA_SEKUNDE = 4 * 60 * 60;
const PKZ_GRANICA_AKTIVNOG_SUSTAVA_SEKUNDE = PKZ_INTERVAL_MJERENJA_SEKUNDE + 30 * 60;
const pkzStatusElementi = document.querySelectorAll(".status-online");
const statusStanjeUredjaja = document.getElementById("status-stanje-uredjaja");
const statusKomunikacija = document.getElementById("status-komunikacija");
const statusStarostPodataka = document.getElementById("status-starost-podataka");
const statusIzvorPodataka = document.getElementById("status-izvor-podataka");
const statusLokacija = document.getElementById("status-lokacija");

function pkzDatumZadnjegMjerenja(mjerenje) {
    if (!mjerenje) return null;

    if (mjerenje.received_at_utc) {
        const datum = new Date(mjerenje.received_at_utc);
        if (!Number.isNaN(datum.getTime())) return datum;
    }

    if (mjerenje.datum && mjerenje.vrijeme) {
        const datum = new Date(`${mjerenje.datum}T${mjerenje.vrijeme}:00`);
        if (!Number.isNaN(datum.getTime())) return datum;
    }

    return null;
}

function pkzTekstStarosti(sekunde) {
    if (sekunde === null || sekunde === undefined || Number.isNaN(Number(sekunde))) {
        return "Nema podataka";
    }

    const brojSekundi = Math.max(0, Number(sekunde));

    if (brojSekundi < 60) return "prije manje od 1 min";

    const minute = Math.floor(brojSekundi / 60);
    if (minute < 60) {
        if (minute === 1) return "prije 1 min";
        return `prije ${minute} min`;
    }

    const sati = Math.floor(minute / 60);
    if (sati === 1) return "prije 1 h";
    return `prije ${sati} h`;
}

function pkzStatusIzMjerenja(mjerenje) {
    if (!mjerenje) {
        return {
            status: "offline",
            text: "Sustav neaktivan",
            description: "Još nije primljeno nijedno TTN mjerenje.",
            age_seconds: null,
            last_measurement: null,
            active_location: aktivnaLokacijaServer
        };
    }

    const datumMjerenja = pkzDatumZadnjegMjerenja(mjerenje);
    const starostSekundi = datumMjerenja
        ? Math.max(0, Math.floor((Date.now() - datumMjerenja.getTime()) / 1000))
        : null;

    if (starostSekundi !== null && starostSekundi <= PKZ_GRANICA_AKTIVNOG_SUSTAVA_SEKUNDE) {
        return {
            status: "active",
            text: "Sustav aktivan",
            description: "Mjerenja redovito dolaze iz TTN-a.",
            age_seconds: starostSekundi,
            last_measurement: mjerenje,
            active_location: aktivnaLokacijaServer
        };
    }

    if (starostSekundi !== null && starostSekundi <= PKZ_GRANICA_AKTIVNOG_SUSTAVA_SEKUNDE + 60 * 60) {
        return {
            status: "offline",
            text: "Sustav neaktivan",
            description: "Nije primljeno novo mjerenje u očekivanom intervalu.",
            age_seconds: starostSekundi,
            last_measurement: mjerenje,
            active_location: aktivnaLokacijaServer
        };
    }

    return {
        status: "offline",
        text: "Sustav neaktivan",
        description: "Dulje vrijeme nije primljeno novo mjerenje.",
        age_seconds: starostSekundi,
        last_measurement: mjerenje
    };
}

function pkzOcistiStatusKlase(element) {
    element.classList.remove(
        "status-aktivan",
        "status-kasni",
        "status-neaktivan",
        "status-ceka"
    );
}

function pkzPrikaziZadnjeMjerenjeNaKarticama(mjerenje) {
    if (!mjerenje) return;

    const pm25Vrijednost = Number(mjerenje.pm25);
    const pm10Vrijednost = Number(mjerenje.pm10);
    const temperaturaVrijednost = Number(mjerenje.temperatura);
    const vlagaVrijednost = Number(mjerenje.vlaga);
    const co2Vrijednost = Number(mjerenje.co2);
    const tlakVrijednost = Number(mjerenje.tlak);

    if (pm25Element && !Number.isNaN(pm25Vrijednost)) pm25Element.innerText = formatirajBroj(pm25Vrijednost, 1) + " µg/m³";
    if (pm10Element && !Number.isNaN(pm10Vrijednost)) pm10Element.innerText = formatirajBroj(pm10Vrijednost, 1) + " µg/m³";
    if (tempElement && !Number.isNaN(temperaturaVrijednost)) tempElement.innerText = formatirajBroj(temperaturaVrijednost, 1) + " °C";
    if (vlagaElement && !Number.isNaN(vlagaVrijednost)) vlagaElement.innerText = formatirajBroj(vlagaVrijednost, 1) + " %";
    if (co2Element && !Number.isNaN(co2Vrijednost)) co2Element.innerText = formatirajBroj(co2Vrijednost, 0) + " ppm";
    if (tlakElement && !Number.isNaN(tlakVrijednost)) tlakElement.innerText = formatirajBroj(tlakVrijednost, 1) + " hPa";

    if (statusPM25 && !Number.isNaN(pm25Vrijednost)) {
        const status = odrediStatusPM25(pm25Vrijednost);
        statusPM25.innerText = status.tekst;
        statusPM25.className = "vrijednost-status " + status.klasa;
    }

    if (statusPM10 && !Number.isNaN(pm10Vrijednost)) {
        const status = odrediStatusPM10(pm10Vrijednost);
        statusPM10.innerText = status.tekst;
        statusPM10.className = "vrijednost-status " + status.klasa;
    }

    if (statusCO2 && !Number.isNaN(co2Vrijednost)) {
        const status = odrediStatusCO2(co2Vrijednost);
        statusCO2.innerText = status.tekst;
        statusCO2.className = "vrijednost-status " + status.klasa;
    }

    if (kvalitetaKartica && kvalitetaZraka && kvalitetaOpis && alarmBox && alarmStatus && alarmOpis && !Number.isNaN(pm25Vrijednost)) {
        kvalitetaKartica.classList.remove("kvaliteta-dobra", "kvaliteta-umjerena", "kvaliteta-losa");
        alarmBox.classList.remove("alarm-normalno", "alarm-upozorenje", "alarm-kriticno");

        if (pm25Vrijednost <= 15) {
            kvalitetaZraka.innerText = "Dobra";
            kvalitetaOpis.innerText = "Vrijednosti su u prihvatljivom rasponu";
            kvalitetaKartica.classList.add("kvaliteta-dobra");
            alarmStatus.innerText = "Nema aktivnih alarma";
            alarmOpis.innerText = "Vrijednosti su unutar normalnih granica.";
            alarmBox.classList.add("alarm-normalno");
        } else if (pm25Vrijednost <= 35) {
            kvalitetaZraka.innerText = "Umjerena";
            kvalitetaOpis.innerText = "Povišene vrijednosti čestica u zraku";
            kvalitetaKartica.classList.add("kvaliteta-umjerena");
            alarmStatus.innerText = "Upozorenje";
            alarmOpis.innerText = "Povišena koncentracija PM2.5 čestica.";
            alarmBox.classList.add("alarm-upozorenje");
        } else {
            kvalitetaZraka.innerText = "Loša";
            kvalitetaOpis.innerText = "Visoke vrijednosti čestica u zraku";
            kvalitetaKartica.classList.add("kvaliteta-losa");
            alarmStatus.innerText = "Kritično stanje";
            alarmOpis.innerText = "Visoka koncentracija PM2.5 čestica. Potrebna je pažnja.";
            alarmBox.classList.add("alarm-kriticno");
        }
    }
}

function pkzPrimijeniStatusSustava(info) {
    const status = info.status || "offline";
    const tekst = info.text || "Sustav neaktivan";
    const zadnje = info.last_measurement || null;

    pkzStatusElementi.forEach((element) => {
        element.textContent = tekst;
        pkzOcistiStatusKlase(element);

        if (status === "active") element.classList.add("status-aktivan");
        else element.classList.add("status-neaktivan");
    });

    if (statusStanjeUredjaja) {
        if (status === "active") statusStanjeUredjaja.textContent = "Aktivan";
        else statusStanjeUredjaja.textContent = "Neaktivan";
    }

    if (statusKomunikacija) {
        if (status === "active") statusKomunikacija.textContent = "U redu";
        else if (zadnje) statusKomunikacija.textContent = "Nema novih mjerenja";
        else statusKomunikacija.textContent = "Nema podataka";
    }

    if (statusZadnjeOcitanje) {
        statusZadnjeOcitanje.textContent = zadnje
            ? `${formatirajDatumHR(zadnje.datum)} ${zadnje.vrijeme}`
            : "Nema podataka";
    }

    if (statusStarostPodataka) {
        statusStarostPodataka.textContent = pkzTekstStarosti(info.age_seconds);
    }

    if (statusIzvorPodataka) {
        statusIzvorPodataka.textContent = zadnje ? "TTN / baza" : "Nema TTN podataka";
    }

    const lokacija = info.active_location || aktivnaLokacijaServer;
    pkzAzurirajPrikazAktivneLokacije(lokacija);

    if (statusLokacija) {
        statusLokacija.textContent = lokacija && lokacija.naziv ? lokacija.naziv : "--";
    }

    if (zadnje) {
        pkzPrikaziZadnjeMjerenjeNaKarticama(zadnje);
    }
}

function pkzOsvjeziStatusSustava() {
    fetch("/api/status", { cache: "no-store" })
        .then((odgovor) => {
            if (!odgovor.ok) throw new Error("Status nije dostupan");
            return odgovor.json();
        })
        .then((info) => {
            pkzPrimijeniStatusSustava(info);
        })
        .catch(() => {
            const zadnjeStvarnoMjerenje = stvarnaMjerenja.length
                ? [...stvarnaMjerenja].sort(usporediMjerenjaOdNajnovijeg)[0]
                : null;
            pkzPrimijeniStatusSustava(pkzStatusIzMjerenja(zadnjeStvarnoMjerenje));
        });
}

pkzOsvjeziStatusSustava();
setInterval(pkzOsvjeziStatusSustava, 30000);


/* Automatska provjera novih mjerenja je isključena kako se stranica ne bi osvježavala u petlji.
   Novi podatak se vidi nakon ručnog osvježavanja stranice, a status se i dalje osvježava preko /api/status. */
