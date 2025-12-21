// main.js - Boundary X Bluetooth Data Streamer Logic

// ===============================
// 전역 상태
// ===============================
const records = [];
const sensorRegistry = {};

let bleDevice = null;
let txChar = null;
let bleBuffer = "";
let isLogging = false;
let wakeLock = null;

const MAX_POINTS = 100;

// ===============================
// DOM Elements
// ===============================
const btnConnect = document.getElementById("btn-connect");
const btnStart = document.getElementById("btn-start");
const btnStop = document.getElementById("btn-stop");
const btnDownload = document.getElementById("btn-download");
const btnClear = document.getElementById("btn-clear");

const statusDiv = document.getElementById("bluetoothStatus");
const basicSensorList = document.getElementById("basic-sensor-list");
const pinSensorList = document.getElementById("pin-sensor-list");

const tableHead = document.getElementById("data-table-head");
const tableBody = document.getElementById("data-table-body");
const tableContainer = document.getElementById("table-container");

const chkKeepScreenOn = document.getElementById("chk-keep-screen-on");
const keepScreenHint = document.getElementById("keep-screen-on-hint");

// ===============================
// Chart.js Setup
// ===============================
const COLOR_PALETTE = [
  "#111111", "#EA4335", "#2563EB", "#137333", 
  "#D97706", "#9333EA", "#0891B2"
];

function getColor(i) {
  return COLOR_PALETTE[i % COLOR_PALETTE.length];
}

const ctx = document.getElementById("chart-canvas").getContext("2d");

const chart = new Chart(ctx, {
  type: "line",
  data: { labels: [], datasets: [] },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: { 
        legend: { position: "top", labels: { usePointStyle: true, boxWidth: 6 } } 
    },
    scales: { 
        x: { grid: { display: false }, ticks: { display: false } }, // X축 깔끔하게
        y: { beginAtZero: false, border: { dash: [4, 4] } } 
    },
    elements: {
      point: { radius: 0 },
      line: { borderWidth: 2, tension: 0.1 }
    }
  }
});

function resetChart() {
  chart.data.labels = [];
  chart.data.datasets = [];
  chart.update();
}

function rebuildChart() {
  const enabledKeys = Object.keys(sensorRegistry).filter(key => sensorRegistry[key].enabled);
  const slice = records.slice(-MAX_POINTS);

  chart.data.labels = slice.map(r => r.timestamp.toLocaleTimeString());
  chart.data.datasets = enabledKeys.map((key, idx) => ({
    label: sensorRegistry[key].label,
    data: slice.map(r => r.values[key] ?? null),
    borderColor: getColor(idx),
    backgroundColor: getColor(idx),
    borderWidth: 2
  }));
  chart.update("none");
}

// ===============================
// UI Updates
// ===============================
function updateStatusUI(status, deviceName = "") {
    if (status === "connected") {
        statusDiv.innerHTML = `상태: ${deviceName} 연결됨`;
        statusDiv.classList.add("status-connected");
        statusDiv.classList.remove("status-error");
        btnConnect.textContent = "연결 해제";
        btnConnect.classList.replace("start-button", "stop-button");
    } else if (status === "error") {
        statusDiv.innerHTML = `상태: 연결 실패 (다시 시도)`;
        statusDiv.classList.add("status-error");
    } else {
        statusDiv.innerHTML = `상태: 연결 대기 중`;
        statusDiv.classList.remove("status-connected");
        statusDiv.classList.remove("status-error");
        btnConnect.textContent = "기기 연결";
        btnConnect.classList.replace("stop-button", "start-button");
    }
}

function renderSensorCheckboxes() {
  basicSensorList.innerHTML = "";
  pinSensorList.innerHTML   = "";

  const keys = Object.keys(sensorRegistry).sort();

  for (const key of keys) {
    const sensor = sensorRegistry[key];
    const container = sensor.type === "pin" ? pinSensorList : basicSensorList;

    const wrapper = document.createElement("div");
    // 순수 CSS 클래스 사용
    wrapper.style.cssText = "display:flex; align-items:center; gap:4px; padding:4px 8px; border:1px solid #eee; border-radius:4px; background:#fafafa;";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.style.cssText = "width:16px; height:16px; accent-color:black;";
    cb.checked = sensor.enabled;

    cb.addEventListener("change", () => {
      sensor.enabled = cb.checked;
      renderTableHeader();
      rebuildChart();
    });

    const span = document.createElement("span");
    span.textContent = sensor.label;
    span.style.cssText = "font-size:0.85rem; cursor:pointer; text-decoration:underline; text-decoration-style:dotted; color:#333;";

    span.addEventListener("click", () => {
      const newName = prompt("센서 이름 변경:", sensor.label);
      if (newName) {
        sensor.label = newName.trim();
        renderSensorCheckboxes();
        renderTableHeader();
        rebuildChart();
      }
    });

    wrapper.appendChild(cb);
    wrapper.appendChild(span);
    container.appendChild(wrapper);
  }
}

function renderTableHeader() {
  tableHead.innerHTML = "";
  const tr = document.createElement("tr");

  const thTime = document.createElement("th");
  thTime.textContent = "Time";
  tr.appendChild(thTime);

  for (const key of Object.keys(sensorRegistry).sort()) {
    const sensor = sensorRegistry[key];
    if (!sensor.enabled) continue;
    const th = document.createElement("th");
    th.textContent = sensor.label;
    tr.appendChild(th);
  }
  tableHead.appendChild(tr);
}

function appendTableRow(record) {
  const tr = document.createElement("tr");
  const tdTime = document.createElement("td");
  tdTime.textContent = record.timestamp.toLocaleTimeString();
  tr.appendChild(tdTime);

  for (const key of Object.keys(sensorRegistry).sort()) {
    const sensor = sensorRegistry[key];
    if (!sensor.enabled) continue;
    const td = document.createElement("td");
    td.textContent = record.values[key] ?? "";
    tr.appendChild(td);
  }
  tableBody.appendChild(tr);
  tableContainer.scrollTop = tableContainer.scrollHeight;
}

function registerSensors(values) {
  let isNew = false;
  for (const key of Object.keys(values)) {
    if (!sensorRegistry[key]) {
      sensorRegistry[key] = {
        key,
        label: key,
        type: key.startsWith("P") ? "pin" : "basic",
        enabled: true
      };
      isNew = true;
    }
  }
  if (isNew) {
      renderSensorCheckboxes();
      renderTableHeader();
  }
}

// ===============================
// Data Logic & BLE
// ===============================
function parseDataLine(line) {
  const obj = {};
  const parts = line.split(";");
  for (const p of parts) {
    const [k, v] = p.split("=");
    if (k && v) {
        const num = Number(v.trim());
        if (!Number.isNaN(num)) obj[k.trim()] = num;
    }
  }
  return obj;
}

const UART_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const UART_TX      = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";

function isBleConnected() {
  return bleDevice && bleDevice.gatt && bleDevice.gatt.connected;
}

async function connectBle() {
  if (!navigator.bluetooth) {
    alert("Chrome 또는 Edge 브라우저에서 실행해주세요.");
    return;
  }
  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: "BBC micro:bit" }],
      optionalServices: [UART_SERVICE]
    });

    bleDevice = device;
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(UART_SERVICE);
    txChar = await service.getCharacteristic(UART_TX);

    await txChar.startNotifications();
    txChar.addEventListener("characteristicvaluechanged", onBleNotify);

    updateStatusUI("connected", device.name);
    bleDevice.addEventListener("gattserverdisconnected", () => {
      bleDevice = null;
      txChar = null;
      updateStatusUI("disconnected");
      stopLogging();
    });
  } catch (err) {
    console.error(err);
    updateStatusUI("error");
  }
}

function onBleNotify(event) {
  const chunk = new TextDecoder().decode(event.target.value);
  bleBuffer += chunk;
  let idx;
  while ((idx = bleBuffer.indexOf("\n")) >= 0) {
    const line = bleBuffer.slice(0, idx).trim();
    bleBuffer = bleBuffer.slice(idx + 1);
    if (!line) continue;
    
    const values = parseDataLine(line);
    if (Object.keys(values).length > 0) {
        registerSensors(values);
        if (isLogging) {
            const record = { timestamp: new Date(), values };
            records.push(record);
            appendTableRow(record);
            rebuildChart();
        }
    }
  }
}

// ===============================
// Controls
// ===============================
async function startLogging() {
  if (!isBleConnected()) {
    alert("먼저 마이크로비트와 연결해주세요.");
    return;
  }
  isLogging = true;
  btnStart.disabled = true;
  btnStop.disabled = false;
  if (chkKeepScreenOn.checked && navigator.wakeLock) {
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      keepScreenHint.textContent = "(화면 켜짐 유지 중)";
    } catch (e) {
      keepScreenHint.textContent = "지원 불가";
    }
  }
}

async function stopLogging() {
  isLogging = false;
  btnStart.disabled = false;
  btnStop.disabled = true;
  keepScreenHint.textContent = "";
  if (wakeLock) { try { await wakeLock.release(); } catch {} wakeLock = null; }
}

function downloadExcel() {
  if (records.length === 0) {
    alert("저장할 데이터가 없습니다.");
    return;
  }
  const keys = Object.keys(sensorRegistry).sort();
  const rows = [ ["Timestamp", ...keys.map(k => sensorRegistry[k].label)] ];
  for (const r of records) {
    rows.push([ r.timestamp.toLocaleString(), ...keys.map(k => r.values[k] ?? "") ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "SensorData");
  const filename = "BoundaryX_Log_" + new Date().toISOString().slice(0,19).replace(/[:T]/g, "-") + ".xlsx";
  XLSX.writeFile(wb, filename);
}

// ===============================
// Event Listeners
// ===============================
btnConnect.addEventListener("click", () => isBleConnected() ? bleDevice.gatt.disconnect() : connectBle());
btnStart.addEventListener("click", startLogging);
btnStop.addEventListener("click", stopLogging);
btnDownload.addEventListener("click", downloadExcel);
btnClear.addEventListener("click", () => {
  records.length = 0;
  tableBody.innerHTML = "";
  resetChart();
});
