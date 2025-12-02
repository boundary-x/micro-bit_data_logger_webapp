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

const MAX_POINTS = 200;

// ===============================
// DOM
// ===============================
const btnConnect = document.getElementById("btn-connect");
const btnStart = document.getElementById("btn-start");
const btnStop = document.getElementById("btn-stop");
const btnDownload = document.getElementById("btn-download");
const btnClear = document.getElementById("btn-clear");

const deviceNameSpan = document.getElementById("device-name");

const basicSensorList = document.getElementById("basic-sensor-list");
const pinSensorList   = document.getElementById("pin-sensor-list");

const tableHead      = document.getElementById("data-table-head");
const tableBody      = document.getElementById("data-table-body");
const tableContainer = document.getElementById("table-container");

const chkKeepScreenOn = document.getElementById("chk-keep-screen-on");
const keepScreenHint  = document.getElementById("keep-screen-on-hint");

// ===============================
// Chart.js (점 제거 라인 그래프)
// ===============================
const COLOR_PALETTE = [
  "#2563eb", "#f97316", "#22c55e",
  "#e11d48", "#a855f7", "#0ea5e9", "#facc15"
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
    animation: false,
    plugins: { legend: { position: "bottom" } },
    scales: { y: { beginAtZero: false } },
    elements: {
      point: { radius: 0 },            // ★ 점 제거
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
  const enabledKeys = Object.keys(sensorRegistry).filter(
    key => sensorRegistry[key].enabled
  );

  const slice = records.slice(-MAX_POINTS);

  chart.data.labels = slice.map(r =>
    r.timestamp.toLocaleTimeString()
  );

  chart.data.datasets = enabledKeys.map((key, idx) => ({
    label: sensorRegistry[key].label,
    data: slice.map(r => r.values[key] ?? null),
    borderColor: getColor(idx),
    backgroundColor: getColor(idx)
  }));

  chart.update("none");
}

// ===============================
// 센서 UI & 등록
// ===============================
function prettyLabel(key) {
  const map = {
    TEMP: "Temperature (°C)",
    Temperature: "Temperature (°C)",
    LIGHT: "Light",
    ACCX: "Accel X",
    ACCY: "Accel Y",
    ACCZ: "Accel Z",
    SOUND: "Sound Level",
    HEAD: "Compass"
  };
  return map[key] || key;
}

function renderSensorCheckboxes() {
  basicSensorList.innerHTML = "";
  pinSensorList.innerHTML   = "";

  const keys = Object.keys(sensorRegistry).sort();

  for (const key of keys) {
    const sensor = sensorRegistry[key];
    const container = sensor.type === "pin" ? pinSensorList : basicSensorList;

    const label = document.createElement("label");
    label.className = "inline-flex items-center gap-1";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "w-4 h-4";
    cb.checked = sensor.enabled;

    cb.addEventListener("change", () => {
      sensor.enabled = cb.checked;
      renderTableHeader();
      rebuildChart();
    });

    const span = document.createElement("span");
    span.textContent = sensor.label;
    span.className =
      "cursor-pointer underline decoration-dotted decoration-slate-300";

    span.addEventListener("click", () => {
      const newName = prompt("센서 이름 변경:", sensor.label);
      if (!newName) return;
      const trimmed = newName.trim();
      if (trimmed) sensor.label = trimmed;

      renderSensorCheckboxes();
      renderTableHeader();
      rebuildChart();
    });

    label.appendChild(cb);
    label.appendChild(span);
    container.appendChild(label);
  }
}

function renderTableHeader() {
  tableHead.innerHTML = "";
  const tr = document.createElement("tr");

  const thTime = document.createElement("th");
  thTime.textContent = "Timestamp";
  thTime.className = "px-2 py-1 border";
  tr.appendChild(thTime);

  for (const key of Object.keys(sensorRegistry).sort()) {
    const sensor = sensorRegistry[key];
    if (!sensor.enabled) continue;

    const th = document.createElement("th");
    th.textContent = sensor.label;
    th.className = "px-2 py-1 border";
    tr.appendChild(th);
  }

  tableHead.appendChild(tr);
}

function appendTableRow(record) {
  const tr = document.createElement("tr");

  const tdTime = document.createElement("td");
  tdTime.textContent = record.timestamp.toLocaleTimeString();
  tdTime.className = "px-2 py-1 border";
  tr.appendChild(tdTime);

  for (const key of Object.keys(sensorRegistry).sort()) {
    const sensor = sensorRegistry[key];
    if (!sensor.enabled) continue;

    const td = document.createElement("td");
    td.textContent = record.values[key] ?? "";
    td.className = "px-2 py-1 border text-right";
    tr.appendChild(td);
  }

  tableBody.appendChild(tr);
  tableContainer.scrollTop = tableContainer.scrollHeight;
}

function registerSensors(values) {
  for (const key of Object.keys(values)) {
    if (!sensorRegistry[key]) {
      sensorRegistry[key] = {
        key,
        label: prettyLabel(key),
        type: key.startsWith("P") ? "pin" : "basic",
        enabled: true
      };
    }
  }
  renderSensorCheckboxes();
  renderTableHeader();
}

// ===============================
// 데이터 파싱
// ===============================
function parseDataLine(line) {
  const obj = {};
  const parts = line.split(";");
  for (const p of parts) {
    const [k, v] = p.split("=");
    if (!k || !v) continue;

    const key = k.trim();
    const num = Number(v.trim());
    if (!Number.isNaN(num)) obj[key] = num;
  }
  return obj;
}

// ===============================
// BLE UART
// ===============================
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
    deviceNameSpan.textContent = device.name || "micro:bit";

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(UART_SERVICE);
    txChar = await service.getCharacteristic(UART_TX);

    await txChar.startNotifications();
    txChar.addEventListener("characteristicvaluechanged", onBleNotify);

    btnConnect.textContent = "Disconnect";

    bleDevice.addEventListener("gattserverdisconnected", () => {
      bleDevice = null;
      txChar = null;
      deviceNameSpan.textContent = "";
      btnConnect.textContent = "Connect";
      stopLogging();
    });

  } catch (err) {
    alert("BLE 연결 실패: " + err);
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
    if (Object.keys(values).length === 0) continue;

    registerSensors(values);

    if (isLogging) {
      const record = { timestamp: new Date(), values };
      records.push(record);
      appendTableRow(record);
      rebuildChart();
    }
  }
}

// ===============================
// 로깅 & Wake Lock
// ===============================
async function startLogging() {
  if (!isBleConnected()) {
    alert("micro:bit와 먼저 연결해주세요.");
    return;
  }

  isLogging = true;
  btnStart.disabled = true;
  btnStop.disabled = false;

  if (chkKeepScreenOn.checked && navigator.wakeLock) {
    try {
      wakeLock = await navigator.wakeLock.request("screen");
    } catch (e) {
      keepScreenHint.textContent = "화면 유지 기능이 지원되지 않습니다.";
    }
  }
}

async function stopLogging() {
  isLogging = false;
  btnStart.disabled = false;
  btnStop.disabled = true;

  if (wakeLock) {
    try { await wakeLock.release(); } catch {}
    wakeLock = null;
  }
}

// ===============================
// 엑셀 다운로드
// ===============================
function downloadExcel() {
  if (records.length === 0) {
    alert("다운로드할 데이터가 없습니다.");
    return;
  }

  const keys = Object.keys(sensorRegistry).sort();
  const rows = [];

  rows.push(["Timestamp", ...keys.map(k => sensorRegistry[k].label)]);

  for (const r of records) {
    rows.push([
      r.timestamp.toLocaleString(),
      ...keys.map(k => r.values[k] ?? "")
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data");

  const filename =
    "microbit_data_" +
    new Date().toISOString().replace(/[:.]/g, "-") +
    ".xlsx";

  XLSX.writeFile(wb, filename);
}

// ===============================
// 이벤트 바인딩
// ===============================
btnConnect.addEventListener("click", () => {
  if (isBleConnected()) {
    bleDevice.gatt.disconnect();
  } else {
    connectBle();
  }
});

btnStart.addEventListener("click", startLogging);
btnStop.addEventListener("click", stopLogging);

btnDownload.addEventListener("click", downloadExcel);

btnClear.addEventListener("click", () => {
  records.length = 0;
  tableBody.innerHTML = "";
  resetChart();
});
