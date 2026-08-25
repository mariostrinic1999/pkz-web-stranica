#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BME280.h>

#include <lmic.h>
#include <hal/hal.h>
#include <SPI.h>

// =====================================================
// TEST DOMETA - ESP32 + RFM95 + SDS021 + MH-Z19B + BME280
// =====================================================
// Ovaj program je namijenjen samo za test dometa.
// - nema deep sleepa
// - senzori ostaju uključeni
// - OTAA spajanje radi se samo jednom nakon uključivanja
// - svaka ~2 minute napravi se novo mjerenje i šalje LoRaWAN paket
// - testni paketi šalju se na FPort 2 kako se ne bi miješali
//   s redovnim mjerenjima na web stranici
// =====================================================

// =====================================================
// PINOVI
// =====================================================

// MOSFET koji uključuje napajanje SDS021 i MH-Z19B.
#define SENSOR_POWER_PIN 12
#define SENSOR_POWER_ON  HIGH
#define SENSOR_POWER_OFF LOW

// SDS021
#define SDS_RX_PIN 25
#define SDS_TX_PIN 26

// MH-Z19B
#define MHZ_RX_PIN 32
#define MHZ_TX_PIN 33

// BME280
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
// POSTAVKE TESTA
// =====================================================

// Razmak između završenog slanja i početka sljedećeg mjerenja.
const uint32_t TEST_INTERVAL_SECONDS = 120UL;

// Početno zagrijavanje senzora nakon uključivanja uređaja.
// Za test dometa je 60 s dovoljno da se ne čeka dugo.
// MH-Z19B može trebati više vremena da se potpuno stabilizira,
// ali to ne utječe na sam test LoRaWAN dometa.
const uint32_t SENSOR_WARMUP_MS = 60000UL;

// Test koristi fiksni SF11 i 14 dBm.
// SF11 daje dobar domet, a paket od 12 bajtova svake 2 minute
// ostaje praktičan za EU868 testiranje.
const dr_t TEST_DATA_RATE = DR_SF11;
const int8_t TEST_TX_POWER_DBM = 14;

// Testni paketi šalju se na FPort 2.
const uint8_t TEST_FPORT = 2;

// =====================================================
// OBJEKTI I STANJA
// =====================================================

HardwareSerial sdsSerial(1);
HardwareSerial mhzSerial(2);

Adafruit_BME280 bme;
bool bmePronaden = false;

static osjob_t sendjob;
static uint8_t payload[12];

uint32_t brojTestnihSlanja = 0;

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
// POMOĆNE DEKLARACIJE
// =====================================================

void do_send(osjob_t *j);
void napraviMjerenje();
void napraviPayload();
bool ocitajSDSJednom(float &pm25Value, float &pm10Value);
int readMHZ19B();

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
  // Briše eventualne stare bajtove da se uzme svježe očitanje.
  while (sdsSerial.available()) {
    sdsSerial.read();
  }

  unsigned long pocetak = millis();

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
// MJERENJE
// =====================================================

void napraviMjerenje() {
  Serial.println();
  Serial.println(F("======================================"));
  Serial.println(F("NOVO MJERENJE ZA TEST DOMETA"));
  Serial.println(F("======================================"));

  float trenutniPM25 = -1;
  float trenutniPM10 = -1;

  if (ocitajSDSJednom(trenutniPM25, trenutniPM10)) {
    pm25 = trenutniPM25;
    pm10 = trenutniPM10;
  } else {
    pm25 = -1;
    pm10 = -1;
  }

  co2 = readMHZ19B();

  if (bmePronaden) {
    temperatura = bme.readTemperature();
    vlaga = bme.readHumidity();
    tlak = bme.readPressure() / 100.0F;
  } else {
    temperatura = NAN;
    vlaga = NAN;
    tlak = NAN;
  }

  Serial.print(F("PM2.5: "));
  Serial.println(pm25, 1);

  Serial.print(F("PM10: "));
  Serial.println(pm10, 1);

  Serial.print(F("CO2: "));
  Serial.println(co2);

  Serial.print(F("Temperatura: "));
  Serial.println(temperatura, 2);

  Serial.print(F("Vlaga: "));
  Serial.println(vlaga, 2);

  Serial.print(F("Tlak: "));
  Serial.println(tlak, 1);
}

// =====================================================
// PAYLOAD - isti format od 12 bajtova kao u redovnom radu
// =====================================================

void writeUint16(uint8_t *buffer, int index, uint16_t value) {
  buffer[index] = highByte(value);
  buffer[index + 1] = lowByte(value);
}

void writeInt16(uint8_t *buffer, int index, int16_t value) {
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
    (!isnan(vlaga) && vlaga >= 0 && vlaga <= 100.0)
      ? (uint16_t)round(vlaga * 100.0)
      : 0xFFFF;

  uint16_t tlakPayload =
    (!isnan(tlak) && tlak > 0 && tlak <= 6553.4)
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

// =====================================================
// SLANJE
// =====================================================

void do_send(osjob_t *j) {
  if (LMIC.opmode & OP_TXRXPEND) {
    Serial.println(F("LoRaWAN je zauzet. Novi pokušaj za 5 sekundi."));

    os_setTimedCallback(
      &sendjob,
      os_getTime() + sec2osticks(5),
      do_send
    );

    return;
  }

  napraviMjerenje();
  napraviPayload();

  brojTestnihSlanja++;

  Serial.print(F("Testni paket broj "));
  Serial.print(brojTestnihSlanja);
  Serial.println(F(" ide na TTN (FPort 2)."));

  LMIC_setTxData2(
    TEST_FPORT,
    payload,
    sizeof(payload),
    0
  );
}

// =====================================================
// LMIC DOGAĐAJI
// =====================================================

void onEvent(ev_t ev) {
  Serial.print(os_getTime());
  Serial.print(F(": "));

  switch (ev) {
    case EV_JOINING:
      Serial.println(F("EV_JOINING - spajanje na TTN"));
      break;

    case EV_JOINED:
      Serial.println(F("EV_JOINED - uređaj je spojen na TTN"));

      // Za pokretni test ADR se isključuje i koristi se fiksni SF.
      LMIC_setAdrMode(0);
      LMIC_setDrTxpow(TEST_DATA_RATE, TEST_TX_POWER_DBM);
      LMIC_setLinkCheckMode(0);

      // Prvo mjerenje i slanje odmah nakon uspješnog spajanja.
      do_send(&sendjob);
      break;

    case EV_JOIN_FAILED:
      Serial.println(F("EV_JOIN_FAILED"));
      break;

    case EV_REJOIN_FAILED:
      Serial.println(F("EV_REJOIN_FAILED"));
      break;

    case EV_TXSTART:
      Serial.println(F("EV_TXSTART - slanje je počelo"));
      break;

    case EV_TXCOMPLETE:
      Serial.println(F("EV_TXCOMPLETE - testni paket je poslan"));

      if (LMIC.txrxFlags & TXRX_ACK) {
        Serial.println(F("Primljen ACK."));
      }

      if (LMIC.dataLen > 0) {
        Serial.print(F("Primljen downlink, broj bajtova: "));
        Serial.println(LMIC.dataLen);
      }

      Serial.print(F("Sljedeće mjerenje i slanje za približno "));
      Serial.print(TEST_INTERVAL_SECONDS);
      Serial.println(F(" sekundi."));

      os_setTimedCallback(
        &sendjob,
        os_getTime() + sec2osticks(TEST_INTERVAL_SECONDS),
        do_send
      );
      break;

    case EV_JOIN_TXCOMPLETE:
      Serial.println(F("Join Request poslan, ali Join Accept nije primljen."));
      break;

    case EV_RXSTART:
      break;

    default:
      Serial.print(F("LMIC događaj: "));
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

  Serial.println();
  Serial.println(F("======================================"));
  Serial.println(F("LoRaWAN TEST DOMETA"));
  Serial.println(F("Mjerenje i slanje približno svake 2 minute"));
  Serial.println(F("======================================"));

  // Uključivanje napajanja senzora.
  pinMode(SENSOR_POWER_PIN, OUTPUT);
  digitalWrite(SENSOR_POWER_PIN, SENSOR_POWER_ON);

  // UART za SDS021.
  sdsSerial.begin(
    9600,
    SERIAL_8N1,
    SDS_RX_PIN,
    SDS_TX_PIN
  );

  // UART za MH-Z19B.
  mhzSerial.begin(
    9600,
    SERIAL_8N1,
    MHZ_RX_PIN,
    MHZ_TX_PIN
  );

  // I2C i BME280.
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);

  bmePronaden = bme.begin(0x76);

  if (!bmePronaden) {
    bmePronaden = bme.begin(0x77);
  }

  if (bmePronaden) {
    Serial.println(F("BME280 pronađen."));
  } else {
    Serial.println(F("BME280 nije pronađen."));
  }

  Serial.print(F("Zagrijavanje senzora "));
  Serial.print(SENSOR_WARMUP_MS / 1000UL);
  Serial.println(F(" sekundi..."));

  delay(SENSOR_WARMUP_MS);

  // Pokretanje LoRaWAN-a.
  SPI.begin(
    LORA_SCK,
    LORA_MISO,
    LORA_MOSI,
    LORA_NSS
  );

  os_init();
  LMIC_reset();

  LMIC_setClockError(MAX_CLOCK_ERROR * 1 / 100);
  LMIC_setLinkCheckMode(0);

  // Fiksni SF11 za test u pokretu.
  LMIC_setAdrMode(0);
  LMIC_setDrTxpow(TEST_DATA_RATE, TEST_TX_POWER_DBM);

  Serial.println(F("Pokrećem OTAA spajanje na TTN..."));
  LMIC_startJoining();
}

// =====================================================
// LOOP
// =====================================================

void loop() {
  os_runloop_once();
}
