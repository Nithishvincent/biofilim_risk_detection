#include <WiFi.h>
#include <WebServer.h>
#include <DHT.h>
#include <ThingSpeak.h> // Install ThingSpeak Library by MathWorks
#include "biofilim_jit_2026/secrets.h" // Adjusted path based on file location

/* ================= WIFI ================= */
// Credentials moved to secrets.h
WiFiClient client;

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

  ThingSpeak.begin(client);

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

  /* ===== ThingSpeak Push (Every 20s) ===== */
  if (millis() % 20000 < 1000) { // Simple non-blocking timer
    ThingSpeak.setField(1, phValue);
    ThingSpeak.setField(2, temperature);
    ThingSpeak.setField(3, humidity);
    ThingSpeak.setField(4, flowRate);
    ThingSpeak.setField(5, turbidityValue);
    ThingSpeak.setField(6, tdsValue);
    
    // Risk score calculation on device (optional, or just send raw)
    // Field 7: Risk Score? Let's verify what the dashboard expects.
    // Dashboard expects risk_score on field 7, status on field 8?
    // Let's check App.jsx again.
    // field1: pH, field2: Temp, field3: Humidity, field4: Flow, field5: Turbidity, field6: TDS, field7: Risk, field8: Status
    
    // Calculate simple risk for display
    float risk = 0;
    if (phValue < 6.5 || phValue > 8.5) risk += 20;
    if (temperature > 30) risk += 20;
    if (turbidityValue > 5) risk += 20;
    if (flowRate < 10) risk += 20;
    if (tdsValue > 1000) risk += 20;
    
    ThingSpeak.setField(7, risk);
    ThingSpeak.setField(8, "Active");

    int x = ThingSpeak.writeFields(channelID, writeAPIKey);
    if(x == 200){
      Serial.println("Channel update successful.");
    }
    else{
      Serial.println("Problem updating channel. HTTP error code " + String(x));
    }
  }

  delay(1000);
}
