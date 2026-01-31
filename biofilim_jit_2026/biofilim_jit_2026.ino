#include <WiFi.h>
#include <WebServer.h>
#include <DHT.h>

/* ================= WIFI ================= */
const char* ssid = "Project";
const char* password = "12345678";

/* ================= WEB ================= */
WebServer server(80);

/* ================= PINS ================= */
#define DHTPIN        2
#define DHTTYPE       DHT11
#define FLOW_PIN      4
#define TURBIDITY_PIN 32
#define TDS_PIN       33

/* ================= OBJECTS ================= */
DHT dht(DHTPIN, DHTTYPE);

/* ================= VALUES ================= */
float temperature = 0;
float humidity = 0;
float phValue = 0;
float turbidityValue = 0;
float tdsValue = 0;

/* ================= FLOW ================= */
volatile uint32_t flowPulses = 0;
float flowRate = 0;
unsigned long lastFlowMillis = 0;

/* ================= FLOW ISR ================= */
void IRAM_ATTR flowISR() {
  flowPulses++;
}

/* ================= STATUS API ================= */
void handleStatus() {
  String json = "{";
  json += "\"ph\":" + String(phValue, 2) + ",";
  json += "\"temperature\":" + String(temperature, 1) + ",";
  json += "\"humidity\":" + String(humidity, 1) + ",";
  json += "\"flow\":" + String(flowRate, 2) + ",";
  json += "\"turbidity\":" + String(turbidityValue) + ",";
  json += "\"tds\":" + String(tdsValue);
  json += "}";

  server.send(200, "application/json", json);
}

/* ================= SETUP ================= */
void setup() {
  Serial.begin(115200);

  /* pH UART */
  Serial2.begin(9600, SERIAL_8N1, 16, 17);
  Serial.println("System Starting...");

  /* WiFi */
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi Connected");
  Serial.println(WiFi.localIP());

  /* DHT */
  dht.begin();

  /* ADC */
  analogReadResolution(12);

  /* Flow */
  pinMode(FLOW_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(FLOW_PIN), flowISR, RISING);

  /* Web */
  server.on("/status", handleStatus);
  server.begin();

  Serial.println("System Ready");
}

/* ================= LOOP ================= */
void loop() {
  server.handleClient();

  /* ===== pH UART ===== */
  if (Serial2.available()) {
    String data = Serial2.readStringUntil('\n');
    int s = data.indexOf("PH:");
    int e = data.indexOf(",", s);
    if (s != -1 && e != -1) {
      phValue = data.substring(s + 3, e).toFloat();
    }
  }

  /* ===== DHT11 ===== */
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (!isnan(t) && !isnan(h)) {
    temperature = t;
    humidity = h;
  }

  /* ===== Analog ===== */
  turbidityValue = analogRead(TURBIDITY_PIN);
  tdsValue = analogRead(TDS_PIN);

  /* ===== Flow ===== */
  if (millis() - lastFlowMillis >= 1000) {
    noInterrupts();
    flowRate = flowPulses;
    flowPulses = 0;
    interrupts();
    lastFlowMillis = millis();
  }

  /* ===== Serial Output ===== */
  Serial.print("pH: "); Serial.print(phValue, 2);
  Serial.print(" | T: "); Serial.print(temperature);
  Serial.print(" | H: "); Serial.print(humidity);
  Serial.print(" | Flow: "); Serial.print(flowRate);
  Serial.print(" | Turb: "); Serial.print(turbidityValue);
  Serial.print(" | TDS: "); Serial.println(tdsValue);

  delay(1000);
}
