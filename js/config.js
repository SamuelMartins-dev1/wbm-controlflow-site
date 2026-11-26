// ============================================================================
// WBM Technology • Supervisório, Gráficos e Relatórios de Testes Control Flow
// ============================================================================

const SUPABASE_URL = "https://nwdextnlntvixacrjifv.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im53ZGV4dG5sbnR2aXhhY3JqaWZ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA1MTQyNjQsImV4cCI6MjA4NjA5MDI2NH0.N3bGloWK1RWg6VXKgm2zXxfwOlKn8ubIIzIFSd24BNc";

const GOOGLE_FORM_ID = "1FAIpQLSfKZcEDkmh44Anhkyk2EBvYyzl3MdBAaC9h1ckC_OaOzgwj0Q";
const GOOGLE_FORM_VIEW_URL = `https://docs.google.com/forms/d/e/${GOOGLE_FORM_ID}/viewform`;
const GOOGLE_FORM_POST_URL = `https://docs.google.com/forms/d/e/${GOOGLE_FORM_ID}/formResponse`;

const FORM_ENTRIES = {
  dataHora: "entry.1202071458",
  responsavel: "entry.1513083425",
  cliente: "entry.1574759881",
  equipamento: "entry.1925839575",
  identificacao: "entry.289370399",
  tipoRegistro: "entry.287916298",
  tipoAcompanhamento: "entry.1368488375",
  fonteInformacoes: "entry.23646529",
  statusOperacional: "entry.1929653038",
  necessitaAcao: "entry.1049771711",
  resumo: "entry.834828785",
  observacoes: "entry.1781559816"
};

const FORM_OPTIONS = {
  responsaveis: ["Helton", "Henrique", "Matheus Ferreira", "Ronilton", "Samuel", "Vitor", "Matheus Coutinho", "Rafael"],
  clientes: ["ArcelorMittal", "UTA SAAE Itabirito Nascente", "ETA SAAE Itabirito", "AvantGarde"],
  equipamentos: ["Control Flow Gate", "Control Parshall Monitor", "Pressure Monitor", "Temp Monitor"],
  identificacoes: [
    "ControlParshal 1 (NASCENTE ITABIRITO)",
    "ControlFlow GATE 1  (ETA ITABIRITO)",
    "PressureMonitor 1 (ETA ITABIRITO)",
    "CONTROLFEED 1 (AVANTGARDE) NS 2112",
    "CONTROLFEED 2 (AVANTGARDE) NS 2111"
  ]
};

const CF_ERRORS = {
  0: "Sem erro (0)",
  1: "Erro 1: Motor não funcionou",
  2: "Erro 2: Falha de acionamento",
  3: "Erro 3: Motor travou (Sobrecorrente / Torque)",
  4: "Erro 4: Sensor de posicionamento com defeito",
  5: "Erro 5: Falha de calibração",
  6: "Erro 6: Desacoplamento do eixo / Timeout sensor",
  7: "Erro 7: Timeout sem comunicação LoRa (> 5 min)"
};


function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showToast(msg) {
  const toast = document.getElementById("toast");
  const toastMsg = document.getElementById("toast-msg");
  if (!toast || !toastMsg) return;
  toastMsg.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => {
    toast.classList.add("hidden");
  }, 4500);
}

function formatTimeShort(iso) {
  if (!iso) return "---";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "---";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDateTimeBR(iso) {
  if (!iso) return "---";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "---";
  return d.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
}

function formatAge(iso) {
  if (!iso) return { text: "Sem leitura", mins: Infinity };
  const diffMs = Date.now() - new Date(iso).getTime();
  const secs = Math.max(0, Math.floor(diffMs / 1000));
  if (secs < 60) return { text: `há ${secs}s`, mins: 0 };
  const mins = Math.floor(secs / 60);
  if (mins < 60) return { text: `há ${mins} min`, mins };
  const hours = Math.floor(mins / 60);
  if (hours < 24) return { text: `há ${hours}h ${mins % 60}m`, mins };
  const days = Math.floor(hours / 24);
  return { text: `há ${days}d ${hours % 24}h`, mins };
}

function getNowForGoogleForms() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

function diffSeconds(isoStart, isoEnd) {
  if (!isoStart || !isoEnd) return null;
  const s = (new Date(isoEnd).getTime() - new Date(isoStart).getTime()) / 1000;
  return s >= 0 && s < 7200 ? Number(s.toFixed(1)) : null;
}

function isPositionConfirmed(sm, po) {
  if (sm === null || sm === undefined || po === null || po === undefined) return false;
  const s = Math.round(Number(sm));
  const p = Math.round(Number(po));
  if ((s === 0 || s === 1) && (p === 0 || p === 1)) return true;
  return Math.abs(p - s) <= 1;
}

const PUBLIC_WEB_SITE_URL = "https://samuelmartins-dev1.github.io/wbm-controlflow-site/";

const CLOUD_DEFAULT_DEVICES = [
  {
    device_id: "Mestre_CC7B5CF20D9C_CF_1",
    name: "Control Flow Gate ETA Itabirito",
    client: "ETA Itabirito",
    type: "CF",
    master_id: "Mestre_CC7B5CF20D9C",
    mac: "CC7B5CF20D9C",
    ed: 1,
    md: 2,
    local_ip: "",
    nominal_current_ma: 4200,
    peak_current_ma: 6800,
    stall_current_ma: 7200,
    test_min: 1,
    test_max: 100,
    test_start_by: "max",
    test_interval_min: 10.0,
    test_timeout_min: 2.0,
    test_max_retries: 3
  },
  {
    device_id: "Mestre_8813BF00CDB0_CF_2",
    name: "Control_Flow teste",
    client: "WBM Technology",
    type: "CF",
    master_id: "Mestre_8813BF00CDB0",
    mac: "8813BF00CDB0",
    ed: 2,
    md: 2,
    local_ip: "",
    nominal_current_ma: 3800,
    peak_current_ma: 6200,
    stall_current_ma: 6800,
    test_min: 1,
    test_max: 100,
    test_start_by: "min",
    test_interval_min: 5.0,
    test_timeout_min: 2.0,
    test_max_retries: 3
  },
  {
    device_id: "Mestre_8813BF00CDB0_CF_1",
    name: "Control Flow CF_1 (MAC 8813BF00CDB0)",
    client: "WBM Technology (MAC 8813BF00CDB0)",
    type: "CF",
    master_id: "Mestre_8813BF00CDB0",
    mac: "8813BF00CDB0",
    ed: 1,
    md: 2,
    local_ip: "",
    nominal_current_ma: 4000,
    peak_current_ma: 6500,
    stall_current_ma: 7000,
    test_min: 1,
    test_max: 100,
    test_start_by: "max",
    test_interval_min: 10.0,
    test_timeout_min: 2.0,
    test_max_retries: 3
  }
];
