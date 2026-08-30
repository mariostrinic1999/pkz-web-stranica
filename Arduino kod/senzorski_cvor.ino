#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BME280.h>
#include <RTClib.h>

#include <lmic.h>
#include <hal/hal.h>
#include <SPI.h>
#include <esp_sleep.h>

// =====================================================
// PINOVI
// =====================================================

// MOSFET koji uključuje napajanje senzora.
#define SENSOR_POWER_PIN 12
#define SENSOR_POWER_ON  HIGH
#define SENSOR_POWER_OFF LOW

// SDS021
#define SDS_RX_PIN 25
#define SDS_TX_PIN 26

// MH-Z19B
#define MHZ_RX_PIN 32
#define MHZ_TX_PIN 33

// BME280 i RTC DS3231 koriste I2C.
#define I2C_SDA_PIN 21
#define I2C_SCL_PIN 22

// RFM95 / SX1276
#define LORA_SCK   18
#define LORA_MISO  19
#define LORA_MOSI  23
#define LORA_NSS    5
#define LORA_RST   13
#define LORA_DIO0  27
#define LORA_DIO1  14

// =====================================================
// RASPORED
// =====================================================

// Senzori se pale 5 minuta prije svakog punog sata.
const uint8_t MINUTA_PALJENJA_SENZORA = 55;

// Podaci se šalju svaka 4 sata:
// 00:00, 04:00, 08:00, 12:00, 16:00 i 20:00.
bool jeSatZaSlanje(uint8_t sat) {
  return (sat % 4) == 0;
}

// =====================================================
// OBJEKTI
// =====================================================

HardwareSerial sdsSerial(1);
HardwareSerial mhzSerial(2);

Adafruit_BME280 bme;
RTC_DS3231 rtc;

bool rtcPronaden = false;
bool bmePronaden = false;
bool lmicPokrenut = false;

static osjob_t sendjob;
static uint8_t payload[12];

// =====================================================
// PODACI KOJI OSTAJU SAČUVANI TIJEKOM DEEP SLEEPA
// =====================================================

// Svaki puni sat napravi se jedno mjerenje.
// Ove sume i brojači ostaju sačuvani tijekom deep sleepa.
// U 00, 04, 08, 12, 16 i 20 sati iz njih se računa prosjek.

RTC_DATA_ATTR double sumaPM25 = 0.0;
RTC_DATA_ATTR double sumaPM10 = 0.0;
RTC_DATA_ATTR uint32_t brojPMUzoraka = 0;

RTC_DATA_ATTR uint64_t sumaCO2 = 0;
RTC_DATA_ATTR uint32_t brojCO2Uzoraka = 0;

RTC_DATA_ATTR double sumaTemperatura = 0.0;
RTC_DATA_ATTR double sumaVlaga = 0.0;
RTC_DATA_ATTR double sumaTlak = 0.0;
RTC_DATA_ATTR uint32_t brojBMEUzoraka = 0;

// Zaštita od dvostrukog mjerenja istog punog sata.
// Sprema Unix vrijeme zadnjeg obrađenog punog sata.
RTC_DATA_ATTR uint32_t zadnjiObradeniTerminUnix = 0;

// Vrijednosti koje se šalju.
float pm25 = -1;
float pm10 = -1;
int co2 = -1;
float temperatura = NAN;
float vlaga = NAN;
float tlak = NAN;

// =====================================================
// OTAA PODACI IZ TTN-a
// =====================================================

static const u1_t PROGMEM APPEUI[8] = {
  0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00
};

static const u1_t PROGMEM DEVEUI[8] = {
  0xD6, 0x85, 0x07, 0xD0,
  0x7E, 0xD5, 0xB3, 0x70
};

static const u1_t PROGMEM APPKEY[16] = {
  0x0D, 0x91, 0x84, 0x0C,
  0x57, 0x07, 0x19, 0x50,
  0xB6, 0xF5, 0x9D, 0xE0,
  0xF8, 0x46, 0x92, 0xFB
};

void os_getArtEui(u1_t *buf) {
  memcpy_P(buf, APPEUI, 8);
}

void os_getDevEui(u1_t *buf) {
  memcpy_P(buf, DEVEUI, 8);
}

void os_getDevKey(u1_t *buf) {
  memcpy_P(buf, APPKEY, 16);
}

// =====================================================
// LMIC PIN MAPA
// =====================================================

const lmic_pinmap lmic_pins = {
  .nss = LORA_NSS,
  .rxtx = LMIC_UNUSED_PIN,
  .rst = LORA_RST,
  .dio = {
    LORA_DIO0,
    LORA_DIO1,
    LMIC_UNUSED_PIN
  },
  .rxtx_rx_active = 0,
  .rssi_cal = 0,
  .spi_freq = 8000000
};

// =====================================================
// POMOĆNE FUNKCIJE ZA VRIJEME
// =====================================================

void ispisiVrijeme(const DateTime &vrijeme) {
  if (vrijeme.day() < 10) Serial.print('0');
  Serial.print(vrijeme.day());
  Serial.print('.');

  if (vrijeme.month() < 10) Serial.print('0');
  Serial.print(vrijeme.month());
  Serial.print('.');
  Serial.print(vrijeme.year());
  Serial.print(F(". "));

  if (vrijeme.hour() < 10) Serial.print('0');
  Serial.print(vrijeme.hour());
  Serial.print(':');

  if (vrijeme.minute() < 10) Serial.print('0');
  Serial.print(vrijeme.minute());
  Serial.print(':');

  if (vrijeme.second() < 10) Serial.print('0');
  Serial.print(vrijeme.second());
}

// Vraća sljedeći trenutak xx:55.
DateTime sljedecePaljenjeSenzora(const DateTime &sada) {
  DateTime kandidat(
    sada.year(),
    sada.month(),
    sada.day(),
    sada.hour(),
    MINUTA_PALJENJA_SENZORA,
    0
  );

  if (kandidat.unixtime() > sada.unixtime()) {
    return kandidat;
  }

  return kandidat + TimeSpan(0, 1, 0, 0);
}

// Vraća puni sat koji slijedi nakon trenutka buđenja u xx:55.
DateTime sljedeciPuniSat(const DateTime &sada) {
  DateTime pocetakSata(
    sada.year(),
    sada.month(),
    sada.day(),
    sada.hour(),
    0,
    0
  );

  return pocetakSata + TimeSpan(0, 1, 0, 0);
}

// =====================================================
// DEEP SLEEP
// =====================================================

void idiNaSleepDo(const DateTime &budenje) {
  DateTime sada = rtc.now();

  int64_t sekunde =
    (int64_t)budenje.unixtime() -
    (int64_t)sada.unixtime();

  if (sekunde < 10) {
    sekunde = 10;
  }

  digitalWrite(SENSOR_POWER_PIN, SENSOR_POWER_OFF);

  Serial.print(F("Sada je: "));
  ispisiVrijeme(sada);
  Serial.println();

  Serial.print(F("Sljedece budenje: "));
  ispisiVrijeme(budenje);
  Serial.println();

  Serial.print(F("ESP32 ide u deep sleep na "));
  Serial.print((long)sekunde);
  Serial.println(F(" sekundi."));

  esp_sleep_enable_timer_wakeup(
    (uint64_t)sekunde * 1000000ULL
  );

  Serial.flush();
  esp_deep_sleep_start();
}

void idiNaSleepDoSljedecegPaljenja() {
  DateTime sada = rtc.now();
  DateTime budenje = sljedecePaljenjeSenzora(sada);
  idiNaSleepDo(budenje);
}

// =====================================================
// NAPAJANJE I POKRETANJE SENZORA
// =====================================================

void ukljuciSenzore() {
  digitalWrite(SENSOR_POWER_PIN, SENSOR_POWER_ON);
  Serial.println(F("Senzori su ukljuceni preko GPIO12."));

  delay(300);

  sdsSerial.begin(
    9600,
    SERIAL_8N1,
    SDS_RX_PIN,
    SDS_TX_PIN
  );

  mhzSerial.begin(
    9600,
    SERIAL_8N1,
    MHZ_RX_PIN,
    MHZ_TX_PIN
  );

  // BME280 je na istoj I2C sabirnici kao RTC.
  bmePronaden = bme.begin(0x76);

  if (!bmePronaden) {
    bmePronaden = bme.begin(0x77);
  }

  if (bmePronaden) {
    Serial.println(F("BME280 pronaden."));
  } else {
    Serial.println(F("BME280 nije pronaden."));
  }
}

void ugasiSenzore() {
  digitalWrite(SENSOR_POWER_PIN, SENSOR_POWER_OFF);
  Serial.println(F("Senzori su iskljuceni preko GPIO12."));
}

// =====================================================
// SDS021
// =====================================================

bool readSDS021(float &pm25Value, float &pm10Value) {
  byte buffer[10];

  while (sdsSerial.available() >= 10) {
    if (sdsSerial.read() != 0xAA) {
      continue;
    }

    buffer[0] = 0xAA;

    for (int i = 1; i < 10; i++) {
      buffer[i] = sdsSerial.read();
    }

    if (buffer[1] != 0xC0 || buffer[9] != 0xAB) {
      continue;
    }

    byte checksum = 0;

    for (int i = 2; i <= 7; i++) {
      checksum += buffer[i];
    }

    if (checksum != buffer[8]) {
      continue;
    }

    int pm25Raw = buffer[2] + (buffer[3] << 8);
    int pm10Raw = buffer[4] + (buffer[5] << 8);

    pm25Value = pm25Raw / 10.0;
    pm10Value = pm10Raw / 10.0;

    return true;
  }

  return false;
}

bool ocitajSDSJednom(float &pm25Value, float &pm10Value) {
  // Obriši stare pakete.
  while (sdsSerial.available()) {
    sdsSerial.read();
  }

  unsigned long pocetak = millis();

  // Čeka najviše 10 sekundi na svježe valjano očitanje.
  while (millis() - pocetak < 10000UL) {
    if (readSDS021(pm25Value, pm10Value)) {
      return true;
    }

    delay(5);
  }

  return false;
}

// =====================================================
// MH-Z19B
// =====================================================

int readMHZ19B() {
  byte command[9] = {
    0xFF, 0x01, 0x86, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x79
  };

  byte response[9];

  while (mhzSerial.available()) {
    mhzSerial.read();
  }

  mhzSerial.write(command, 9);
  mhzSerial.flush();

  unsigned long pocetak = millis();
  int index = 0;

  while (millis() - pocetak < 1000UL) {
    if (mhzSerial.available()) {
      response[index++] = mhzSerial.read();

      if (index == 9) {
        break;
      }
    }

    delay(1);
  }

  if (index != 9) {
    return -1;
  }

  if (response[0] != 0xFF || response[1] != 0x86) {
    return -1;
  }

  byte checksum = 0;

  for (int i = 1; i < 8; i++) {
    checksum += response[i];
  }

  checksum = 0xFF - checksum + 1;

  if (checksum != response[8]) {
    return -1;
  }

  return response[2] * 256 + response[3];
}

// =====================================================
// JEDNO SATNO MJERENJE
// =====================================================

void napraviJednoSatnoMjerenje() {
  Serial.println();
  Serial.println(F("======================================"));
  Serial.println(F("SATNO MJERENJE"));
  Serial.println(F("======================================"));

  float trenutniPM25;
  float trenutniPM10;

  if (ocitajSDSJednom(trenutniPM25, trenutniPM10)) {
    if (trenutniPM25 >= 0 && trenutniPM10 >= 0) {
      sumaPM25 += trenutniPM25;
      sumaPM10 += trenutniPM10;
      brojPMUzoraka++;

      Serial.print(F("PM2.5: "));
      Serial.println(trenutniPM25, 1);

      Serial.print(F("PM10: "));
      Serial.println(trenutniPM10, 1);
    }
  } else {
    Serial.println(F("SDS021 nema valjano mjerenje."));
  }

  int trenutniCO2 = readMHZ19B();

  if (trenutniCO2 > 0) {
    sumaCO2 += trenutniCO2;
    brojCO2Uzoraka++;

    Serial.print(F("CO2: "));
    Serial.println(trenutniCO2);
  } else {
    Serial.println(F("MH-Z19B nema valjano mjerenje."));
  }

  if (bmePronaden) {
    float t = bme.readTemperature();
    float h = bme.readHumidity();
    float p = bme.readPressure() / 100.0F;

    if (!isnan(t) && !isnan(h) && !isnan(p)) {
      sumaTemperatura += t;
      sumaVlaga += h;
      sumaTlak += p;
      brojBMEUzoraka++;

      Serial.print(F("Temperatura: "));
      Serial.println(t, 2);

      Serial.print(F("Vlaga: "));
      Serial.println(h, 2);

      Serial.print(F("Tlak: "));
      Serial.println(p, 1);
    } else {
      Serial.println(F("BME280 nema valjano mjerenje."));
    }
  }

  Serial.println(F("--------------------------------------"));
  Serial.print(F("Dosad spremljeno PM mjerenja: "));
  Serial.println(brojPMUzoraka);

  Serial.print(F("Dosad spremljeno CO2 mjerenja: "));
  Serial.println(brojCO2Uzoraka);

  Serial.print(F("Dosad spremljeno BME mjerenja: "));
  Serial.println(brojBMEUzoraka);
}

// =====================================================
// PROSJEK I PAYLOAD
// =====================================================

void izracunajProsjeke() {
  if (brojPMUzoraka > 0) {
    pm25 = sumaPM25 / brojPMUzoraka;
    pm10 = sumaPM10 / brojPMUzoraka;
  } else {
    pm25 = -1;
    pm10 = -1;
  }

  if (brojCO2Uzoraka > 0) {
    co2 = (int)round(
      (double)sumaCO2 / brojCO2Uzoraka
    );
  } else {
    co2 = -1;
  }

  if (brojBMEUzoraka > 0) {
    temperatura =
      sumaTemperatura / brojBMEUzoraka;

    vlaga =
      sumaVlaga / brojBMEUzoraka;

    tlak =
      sumaTlak / brojBMEUzoraka;
  } else {
    temperatura = NAN;
    vlaga = NAN;
    tlak = NAN;
  }

  Serial.println();
  Serial.println(F("======================================"));
  Serial.println(F("PROSJECI ZA SLANJE"));
  Serial.println(F("======================================"));

  Serial.print(F("PM2.5 prosjek iz "));
  Serial.print(brojPMUzoraka);
  Serial.print(F(" mjerenja: "));
  Serial.println(pm25, 1);

  Serial.print(F("PM10 prosjek iz "));
  Serial.print(brojPMUzoraka);
  Serial.print(F(" mjerenja: "));
  Serial.println(pm10, 1);

  Serial.print(F("CO2 prosjek iz "));
  Serial.print(brojCO2Uzoraka);
  Serial.print(F(" mjerenja: "));
  Serial.println(co2);

  Serial.print(F("Temperatura prosjek iz "));
  Serial.print(brojBMEUzoraka);
  Serial.print(F(" mjerenja: "));
  Serial.println(temperatura, 2);

  Serial.print(F("Vlaga prosjek: "));
  Serial.println(vlaga, 2);

  Serial.print(F("Tlak prosjek: "));
  Serial.println(tlak, 1);
}

void writeUint16(
  uint8_t *buffer,
  int index,
  uint16_t value
) {
  buffer[index] = highByte(value);
  buffer[index + 1] = lowByte(value);
}

void writeInt16(
  uint8_t *buffer,
  int index,
  int16_t value
) {
  buffer[index] = highByte(value);
  buffer[index + 1] = lowByte(value);
}

void napraviPayload() {
  uint16_t pm25Payload =
    (pm25 >= 0 && pm25 <= 6553.4)
      ? (uint16_t)round(pm25 * 10.0)
      : 0xFFFF;

  uint16_t pm10Payload =
    (pm10 >= 0 && pm10 <= 6553.4)
      ? (uint16_t)round(pm10 * 10.0)
      : 0xFFFF;

  uint16_t co2Payload =
    (co2 > 0 && co2 < 65535)
      ? (uint16_t)co2
      : 0xFFFF;

  int16_t temperaturaPayload =
    (!isnan(temperatura) &&
     temperatura > -327.67 &&
     temperatura < 327.67)
      ? (int16_t)round(temperatura * 100.0)
      : INT16_MIN;

  uint16_t vlagaPayload =
    (!isnan(vlaga) &&
     vlaga >= 0 &&
     vlaga <= 100.0)
      ? (uint16_t)round(vlaga * 100.0)
      : 0xFFFF;

  uint16_t tlakPayload =
    (!isnan(tlak) &&
     tlak > 0 &&
     tlak <= 6553.4)
      ? (uint16_t)round(tlak * 10.0)
      : 0xFFFF;

  writeUint16(payload, 0, pm25Payload);
  writeUint16(payload, 2, pm10Payload);
  writeUint16(payload, 4, co2Payload);
  writeInt16(payload, 6, temperaturaPayload);
  writeUint16(payload, 8, vlagaPayload);
  writeUint16(payload, 10, tlakPayload);

  Serial.print(F("Payload HEX: "));

  for (uint8_t i = 0; i < sizeof(payload); i++) {
    if (payload[i] < 0x10) {
      Serial.print('0');
    }

    Serial.print(payload[i], HEX);
    Serial.print(' ');
  }

  Serial.println();
}

void resetirajSpremljenaMjerenja() {
  sumaPM25 = 0.0;
  sumaPM10 = 0.0;
  brojPMUzoraka = 0;

  sumaCO2 = 0;
  brojCO2Uzoraka = 0;

  sumaTemperatura = 0.0;
  sumaVlaga = 0.0;
  sumaTlak = 0.0;
  brojBMEUzoraka = 0;

  Serial.println(F("Spremljena mjerenja su resetirana nakon slanja."));
}

// =====================================================
// LORA / LMIC
// =====================================================

void do_send(osjob_t *j) {
  if (LMIC.opmode & OP_TXRXPEND) {
    os_setTimedCallback(
      &sendjob,
      os_getTime() + sec2osticks(5),
      do_send
    );

    return;
  }

  LMIC_setTxData2(
    1,
    payload,
    sizeof(payload),
    0
  );

  Serial.println(
    F("Mjerenja su stavljena u red za LoRaWAN slanje.")
  );
}

void pokreniLoRaSlanje() {
  SPI.begin(
    LORA_SCK,
    LORA_MISO,
    LORA_MOSI,
    LORA_NSS
  );

  os_init();
  LMIC_reset();

  LMIC_setClockError(
    MAX_CLOCK_ERROR * 1 / 100
  );

  LMIC_setAdrMode(1);
  LMIC_setDrTxpow(DR_SF7, 14);
  LMIC_setLinkCheckMode(0);

  lmicPokrenut = true;

  Serial.println(F("Pokrecem OTAA spajanje na TTN."));
  LMIC_startJoining();
}

void onEvent(ev_t ev) {
  Serial.print(os_getTime());
  Serial.print(F(": "));

  switch (ev) {
    case EV_JOINING:
      Serial.println(F("EV_JOINING"));
      break;

    case EV_JOINED:
      Serial.println(F("EV_JOINED"));

      LMIC_setLinkCheckMode(0);
      do_send(&sendjob);
      break;

    case EV_JOIN_FAILED:
      Serial.println(F("EV_JOIN_FAILED"));
      break;

    case EV_REJOIN_FAILED:
      Serial.println(F("EV_REJOIN_FAILED"));
      break;

    case EV_TXSTART:
      Serial.println(F("EV_TXSTART"));
      break;

    case EV_TXCOMPLETE:
      Serial.println(
        F("EV_TXCOMPLETE - poruka je poslana")
      );

      if (LMIC.txrxFlags & TXRX_ACK) {
        Serial.println(F("Primljen ACK."));
      }

      if (LMIC.dataLen > 0) {
        Serial.print(
          F("Primljen downlink, broj bajtova: ")
        );
        Serial.println(LMIC.dataLen);
      }

      // Tek nakon završenog slanja brišu se stare sume.
      resetirajSpremljenaMjerenja();

      // Tražena dodatna izmjena:
      // LoRa radio ide u sleep prije ESP32 deep sleepa.
      LMIC_shutdown();
      Serial.println(
        F("RFM95/SX1276 je stavljen u sleep mode.")
      );

      ugasiSenzore();
      idiNaSleepDoSljedecegPaljenja();
      break;

    case EV_JOIN_TXCOMPLETE:
      Serial.println(
        F("Join Request poslan, Join Accept nije primljen.")
      );
      break;

    case EV_RXSTART:
      break;

    default:
      Serial.print(F("LMIC dogadaj: "));
      Serial.println((unsigned)ev);
      break;
  }
}

// =====================================================
// SETUP
// =====================================================

void setup() {
  Serial.begin(115200);
  delay(1000);

  pinMode(SENSOR_POWER_PIN, OUTPUT);
  digitalWrite(
    SENSOR_POWER_PIN,
    SENSOR_POWER_OFF
  );

  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);

  rtcPronaden = rtc.begin();

  if (!rtcPronaden) {
    Serial.println(F("RTC DS3231 nije pronaden."));
    Serial.println(
      F("Bez RTC-a ovaj raspored ne moze raditi.")
    );

    return;
  }

  if (rtc.lostPower()) {
    Serial.println(
      F("RTC je izgubio napajanje.")
    );

    Serial.println(
      F("Postavljam vrijeme prema kompajliranju.")
    );

    rtc.adjust(
      DateTime(F(__DATE__), F(__TIME__))
    );
  }

  DateTime sada = rtc.now();

  Serial.print(F("RTC vrijeme: "));
  ispisiVrijeme(sada);
  Serial.println();

  // Ako je uređaj uključen prije xx:55,
  // spava do sljedećeg xx:55.
  if (sada.minute() < MINUTA_PALJENJA_SENZORA) {
    DateTime budenje(
      sada.year(),
      sada.month(),
      sada.day(),
      sada.hour(),
      MINUTA_PALJENJA_SENZORA,
      0
    );

    idiNaSleepDo(budenje);
  }

  // U xx:55 ili kasnije senzori se uključuju.
  // Cilj je očitati ih na sljedeći puni sat.
  DateTime terminMjerenja =
    sljedeciPuniSat(sada);

  Serial.print(F("Termin mjerenja: "));
  ispisiVrijeme(terminMjerenja);
  Serial.println();

  ukljuciSenzore();

  // Čeka do punog sata. Senzori se za to vrijeme zagrijavaju.
  while (rtc.now().unixtime() <
         terminMjerenja.unixtime()) {
    delay(100);
  }

  uint32_t terminUnix =
    terminMjerenja.unixtime();

  // Zaštita od dvostrukog mjerenja istog termina.
  if (zadnjiObradeniTerminUnix != terminUnix) {
    napraviJednoSatnoMjerenje();
    zadnjiObradeniTerminUnix = terminUnix;
  } else {
    Serial.println(
      F("Ovaj puni sat je vec obraden.")
    );
  }

  uint8_t satMjerenja =
    terminMjerenja.hour();

  if (jeSatZaSlanje(satMjerenja)) {
    Serial.println(
      F("Ovo je termin za slanje svaka 4 sata.")
    );

    izracunajProsjeke();
    napraviPayload();

    // Senzori više nisu potrebni dok traje LoRa slanje.
    ugasiSenzore();

    pokreniLoRaSlanje();
  } else {
    Serial.println(
      F("Ovo nije termin za LoRaWAN slanje.")
    );

    ugasiSenzore();
    idiNaSleepDoSljedecegPaljenja();
  }
}

// =====================================================
// LOOP
// =====================================================

void loop() {
  if (lmicPokrenut) {
    os_runloop_once();
  } else {
    delay(100);
  }
}
