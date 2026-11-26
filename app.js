// ============================================================================
// WBM Technology • Lógica Principal, Comunicação Híbrida e Gráficos
// (Constantes e utilitários carregados via js/config.js)
// ============================================================================

const state = {
  mqtt: {},
  devices: [],
  live: {},
  recentFeed: [],
  botLogs: [],
  recentCommands: [],
  newlyDiscovered: [],
  knownMasters: [],
  notifiedDiscoveryKeys: new Set(),
  initialLoadDone: false,
  configJson: {},
  activeView: localStorage.getItem("wbm_cf_active_view") || "device", // 'automation' | 'device'
  selectedDeviceId: localStorage.getItem("wbm_cf_selected_tab") || null,
  deviceCommandModes: JSON.parse(localStorage.getItem("wbm_cf_cmd_modes") || "{}"), // { [device_id]: 'auto' | 'manual' }
  singleTabCommandMode: localStorage.getItem("wbm_cf_single_cmd_mode") || "auto", // 'auto' | 'manual'
  globalHistorySubTab: localStorage.getItem("wbm_cf_global_hist_tab") || "logs", // 'logs' | 'topics' | 'audit'
  globalHistoryDeviceFilter: localStorage.getItem("wbm_cf_global_hist_dev_filter") || "ALL",
  cardHistoryTabs: JSON.parse(localStorage.getItem("wbm_cf_card_hist_tabs") || "{}"), // { [device_id]: 'topics' | 'commands' }
  deviceTopicTypeFilter: localStorage.getItem("wbm_cf_dev_topic_filter") || "ALL", // 'ALL' | 'telemetry' | 'status' | 'cmd'
  manualSmValues: JSON.parse(localStorage.getItem("wbm_cf_manual_sm_values") || "{}"),
  useMasterTopic: localStorage.getItem("wbm_cf_use_master_topic") === "true",
  reportPrefs: JSON.parse(localStorage.getItem("wbm_cf_report_prefs") || "{}"),
  initialInputsPopulated: false,
  editingConfigJson: false,
  editingBotCardInputs: {},
  currentDetail: {
    config: null,
    live: null,
    telemetry_history: [],
    commands_audit: [],
    error_history: [],
    mqtt_feed_history: [],
    bot_logs_history: []
  },
  supabaseToken: null,
  email: localStorage.getItem("wbm_email") || "matheus.coutinho@wbmtechnology.com.br",
  password: localStorage.getItem("wbm_password") || "wbm_technology",
  charts: {
    setpointPos: null,
    motorCurrent: null,
    errorsTimeline: null,
    latencyCycles: null
  },
  reportDirty: false
};

// ============================================================================
// Utilitários de Formatação
// ============================================================================


const cloudEngine = {
  isCloudMode: false,
  token: null,
  userId: null,
  devicesMap: {},
  rawMetadataByDevice: {},
  liveMap: {},
  botLogs: JSON.parse(localStorage.getItem("wbm_cf_cloud_bot_logs") || "[]"),
  recentFeed: [],
  recentCommands: [],
  botTimers: {},
  detailCache: {}
};

function initCloudDevicesFromStorage() {
  const saved = JSON.parse(localStorage.getItem("wbm_cf_cloud_devices") || "null");
  const list = Array.isArray(saved) && saved.length > 0 ? saved : CLOUD_DEFAULT_DEVICES;
  for (const d of list) {
    cloudEngine.devicesMap[d.device_id] = { ...d };
    if (!cloudEngine.liveMap[d.device_id]) {
      cloudEngine.liveMap[d.device_id] = {
        device_id: d.device_id,
        last_seen: null,
        last_status_ack: null,
        last_status_at: null,
        po: null,
        sm: null,
        ed: d.ed ?? 1,
        md: d.md ?? 2,
        qc: null,
        qv: null,
        er: 0,
        corrente: 0,
        media_corrente: d.nominal_current_ma || 4000,
        pico_corrente: 0,
        corrente_trava: d.stall_current_ma || 7000,
        current_source: "Nuvem WBM / MQTT",
        is_moving: false,
        pos_verify_state: "idle",
        test_running: Boolean(d.test_running),
        test_phase: d.test_running ? "Retomando automação..." : "Parado",
        test_next_in_sec: 0,
        test_cycles_done: 0,
        test_cycles_ok: 0,
        test_cycles_fail: 0
      };
    }
  }
}
initCloudDevicesFromStorage();

function saveCloudDevicesToStorage() {
  localStorage.setItem("wbm_cf_cloud_devices", JSON.stringify(Object.values(cloudEngine.devicesMap)));
}

function pushCloudBotLog(message, devId = null) {
  const tsStr = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const entry = {
    time: tsStr,
    created_at: new Date().toISOString(),
    device_id: devId,
    message
  };
  cloudEngine.botLogs.unshift(entry);
  if (cloudEngine.botLogs.length > 200) cloudEngine.botLogs.pop();
  localStorage.setItem("wbm_cf_cloud_bot_logs", JSON.stringify(cloudEngine.botLogs.slice(0, 120)));
}

async function ensureCloudAuth() {
  if (cloudEngine.token && cloudEngine.userId) return cloudEngine.token;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email: state.email || "matheus.coutinho@wbmtechnology.com.br",
      password: state.password || "wbm_technology"
    })
  });
  if (!res.ok) throw new Error("Falha ao autenticar no servidor WBM Cloud");
  const data = await res.json();
  cloudEngine.token = data.access_token;
  cloudEngine.userId = data.user?.id;
  return cloudEngine.token;
}

async function cloudRestGet(tableAndQuery) {
  const token = await ensureCloudAuth();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${tableAndQuery}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`
    }
  });
  if (!res.ok) throw new Error(`Cloud GET HTTP ${res.status}`);
  return await res.json();
}

async function cloudRestPost(table, payload) {
  const token = await ensureCloudAuth();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`Cloud POST HTTP ${res.status}`);
  return await res.json();
}

async function cloudRestPatch(tableAndQuery, payload) {
  const token = await ensureCloudAuth();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${tableAndQuery}`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`Cloud PATCH HTTP ${res.status}`);
  return await res.json();
}

async function cloudFinalizePendingBridgeCommands(deviceId = null) {
  try {
    const devFilter = deviceId ? `&device_id=eq.${encodeURIComponent(deviceId)}` : "";
    const nowIso = new Date().toISOString();
    await cloudRestPatch(`commands_log?status=in.(pending,published)${devFilter}`, {
      status: "confirmed",
      confirmed_at: nowIso,
      superseded_at: nowIso
    });
  } catch (_) {}
}

async function persistCloudDeviceToSupabase(devId) {
  try {
    const cfg = cloudEngine.devicesMap[devId];
    if (!cfg) return;
    const baseMeta = (cloudEngine.rawMetadataByDevice[devId] && typeof cloudEngine.rawMetadataByDevice[devId] === "object")
      ? { ...cloudEngine.rawMetadataByDevice[devId] }
      : {};
    baseMeta.wbm_cf_config = {
      ed: Number(cfg.ed ?? 1),
      md: Number(cfg.md ?? 2),
      test_min: Number(cfg.test_min ?? 1),
      test_max: Number(cfg.test_max ?? 100),
      test_start_by: cfg.test_start_by || "max",
      test_interval_min: Number(cfg.test_interval_min ?? 10.0),
      test_timeout_min: Number(cfg.test_timeout_min ?? 2.0),
      test_max_retries: Number(cfg.test_max_retries ?? 3),
      test_running: Boolean(cfg.test_running),
      test_current_use_max: cfg.test_current_use_max ?? null,
      test_next_target_epoch_ms: cfg.test_next_target_epoch_ms ?? null,
      nominal_current_ma: Number(cfg.nominal_current_ma ?? 4000),
      peak_current_ma: Number(cfg.peak_current_ma ?? 6500),
      stall_current_ma: Number(cfg.stall_current_ma ?? 7000),
      local_ip: cfg.local_ip || "",
      updated_at: cfg.updated_at || new Date().toISOString()
    };
    cloudEngine.rawMetadataByDevice[devId] = baseMeta;
    await cloudRestPatch(`devices?device_id=eq.${encodeURIComponent(devId)}`, {
      name: cfg.name || devId,
      location: cfg.client || "WBM Technology",
      valve_address: Number(cfg.ed ?? 1),
      node: Number(cfg.ed ?? 1),
      metadata: baseMeta
    });
  } catch (_) {}
}

function mapSupabaseCmdToAudit(c) {
  const cmdObj = c.command || {};
  const sm = Number(cmdObj.sm ?? 0);
  const ed = Number(cmdObj.ed ?? 1);
  const md = Number(cmdObj.md ?? 2);
  const sentAt = c.published_at || c.requested_at;
  const ack1 = c.master_confirmed_at || c.confirmed_at || (c.ack_payload?.receivedAt) || null;
  const ack2 = c.valve_received_at || null;
  const ack3 = c.position_reached_at || null;

  let status = "sent";
  if (ack3) status = "ack3_positioned";
  else if (ack2) status = "ack2_valve";
  else if (ack1 || c.status === "confirmed") status = "ack1_master";

  return {
    id: c.id,
    device_id: c.device_id,
    topic: `devices/${c.device_id}/cmd`,
    ed,
    md,
    sm,
    cmd_type: sm <= 100 ? `Setpoint Posição (${sm}%)` : `Comando SM=${sm}`,
    origin: "Site Web / Nuvem MQTT",
    attempt: 1,
    max_attempts: 1,
    sent_at: sentAt,
    ack1_at: ack1,
    ack2_at: ack2,
    ack3_at: ack3,
    pos_confirmed_at: ack3,
    initial_po: null,
    final_po: ack3 ? sm : null,
    status
  };
}

async function cloudBuildState() {
  cloudEngine.isCloudMode = true;
  const [cfLatest, cfDevices, cmdRows, cfHistRecent] = await Promise.all([
    cloudRestGet("controlflow_latest?select=*"),
    cloudRestGet("devices?device_id=like.*_CF_*&select=*"),
    cloudRestGet("commands_log?device_id=like.*_CF_*&order=requested_at.desc&limit=100"),
    cloudRestGet("controlflow_history?order=created_at.desc&limit=80")
  ]);

  for (const row of cfDevices || []) {
    const devId = (row.device_id || "").trim();
    if (!devId) continue;
    const m = devId.match(/^Mestre_([0-9A-Fa-f]{12})_CF_(\d+)$/i);
    if (!m) continue;
    const mac = m[1].toUpperCase();
    const ed = Number(row.valve_address || row.node || m[2] || 1);
    const hadLocal = Boolean(cloudEngine.devicesMap[devId]);
    const existing = cloudEngine.devicesMap[devId] || {
      device_id: devId,
      type: "CF",
      master_id: `Mestre_${mac}`,
      mac,
      ed,
      md: 2,
      nominal_current_ma: 4000,
      peak_current_ma: 6500,
      stall_current_ma: 7000,
      test_min: 1,
      test_max: 100,
      test_start_by: "max",
      test_interval_min: 10.0,
      test_timeout_min: 2.0,
      test_max_retries: 3,
      test_running: false
    };
    if (row.name) existing.name = row.name;
    if (row.location) existing.client = row.location;

    if (row.metadata && typeof row.metadata === "object") {
      cloudEngine.rawMetadataByDevice[devId] = row.metadata;
      const cfCfg = row.metadata.wbm_cf_config;
      if (cfCfg && typeof cfCfg === "object") {
        const cloudTs = cfCfg.updated_at ? new Date(cfCfg.updated_at).getTime() : 0;
        const localTs = existing.updated_at ? new Date(existing.updated_at).getTime() : 0;
        if (!hadLocal || !localTs || cloudTs > localTs) {
          Object.assign(existing, {
            ed: Number(cfCfg.ed ?? existing.ed ?? ed),
            md: Number(cfCfg.md ?? existing.md ?? 2),
            test_min: Number(cfCfg.test_min ?? existing.test_min ?? 1),
            test_max: Number(cfCfg.test_max ?? existing.test_max ?? 100),
            test_start_by: cfCfg.test_start_by || existing.test_start_by || "max",
            test_interval_min: Number(cfCfg.test_interval_min ?? existing.test_interval_min ?? 10.0),
            test_timeout_min: Number(cfCfg.test_timeout_min ?? existing.test_timeout_min ?? 2.0),
            test_max_retries: Number(cfCfg.test_max_retries ?? existing.test_max_retries ?? 3),
            test_running: Boolean(cfCfg.test_running ?? existing.test_running),
            test_current_use_max: cfCfg.test_current_use_max ?? existing.test_current_use_max ?? null,
            test_next_target_epoch_ms: cfCfg.test_next_target_epoch_ms ?? existing.test_next_target_epoch_ms ?? null,
            nominal_current_ma: Number(cfCfg.nominal_current_ma ?? existing.nominal_current_ma ?? 4000),
            peak_current_ma: Number(cfCfg.peak_current_ma ?? existing.peak_current_ma ?? 6500),
            stall_current_ma: Number(cfCfg.stall_current_ma ?? existing.stall_current_ma ?? 7000),
            local_ip: cfCfg.local_ip ?? existing.local_ip ?? "",
            updated_at: cfCfg.updated_at || existing.updated_at
          });
        }
      }
    }
    cloudEngine.devicesMap[devId] = existing;
  }
  saveCloudDevicesToStorage();

  const mappedCmds = (cmdRows || []).map(mapSupabaseCmdToAudit);
  cloudEngine.recentCommands = mappedCmds;

  // Constrói feed MQTT combinando telemetrias e comandos/status da nuvem
  const feed = [];
  for (const h of cfHistRecent || []) {
    feed.push({
      topic: `devices/${h.device_id}/telemetry`,
      device_id: h.device_id,
      msg_type: "telemetry",
      payload: JSON.stringify({ ed: h.ed, md: h.md, po: h.po, qc: h.qc, qv: h.qv, er: h.er }),
      created_at: h.created_at
    });
  }
  for (const c of cmdRows || []) {
    feed.push({
      topic: `devices/${c.device_id}/cmd`,
      device_id: c.device_id,
      msg_type: "cmd_out",
      payload: JSON.stringify(c.command || {}),
      created_at: c.published_at || c.requested_at
    });
    if (c.ack_payload) {
      feed.push({
        topic: `devices/${c.device_id}/status`,
        device_id: c.device_id,
        msg_type: "status",
        payload: String(c.ack_payload.raw || "1"),
        created_at: c.ack_payload.receivedAt || c.confirmed_at || c.published_at
      });
    }
  }
  feed.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  cloudEngine.recentFeed = feed.slice(0, 160);

  for (const devId of Object.keys(cloudEngine.devicesMap)) {
    const d = cloudEngine.devicesMap[devId];
    if (!cloudEngine.liveMap[devId]) {
      cloudEngine.liveMap[devId] = { device_id: devId, ed: d.ed, md: d.md, er: 0, pos_verify_state: "idle", test_running: false, test_phase: "Parado" };
    }
    const st = cloudEngine.liveMap[devId];
    const lat = (cfLatest || []).find(r => r.device_id === devId);
    const devCmds = mappedCmds.filter(c => c.device_id === devId);
    const lastPosCmd = devCmds.find(c => c.sm >= 0 && c.sm <= 100);

    if (lat) {
      st.last_seen = lat.updated_at;
      st.po = lat.po !== null && lat.po !== undefined ? Number(lat.po) : st.po;
      st.qc = lat.qc ?? st.qc;
      st.qv = lat.qv ?? st.qv;
      st.er = Number(lat.er || 0);
      if (lat.md in [1, 2]) st.md = Number(lat.md);
    }
    if (lastPosCmd && st.sm === null) {
      st.sm = Number(lastPosCmd.sm);
    }
    if (devCmds[0]) {
      if (devCmds[0].ack3_at || isPositionConfirmed(st.sm, st.po)) {
        st.last_status_ack = "3";
        st.pos_verify_state = "confirmed";
      } else if (devCmds[0].ack2_at) {
        st.last_status_ack = "2";
      } else if (devCmds[0].ack1_at) {
        st.last_status_ack = "1";
      }
    }
    if (st.po !== null && st.sm === null) {
      st.sm = st.po;
      st.pos_verify_state = "synced";
    }
    if (d.test_running && !cloudEngine.botTimers[devId]) {
      startCloudBotTimer(devId, null, true);
    } else if (cloudEngine.botTimers[devId]) {
      st.test_running = true;
    }
  }

  const botDispositivos = Object.values(cloudEngine.devicesMap).map(d => ({
    device_id: d.device_id,
    name: d.name,
    valor_ed: d.ed,
    valor_md: d.md,
    valor_min: d.test_min,
    valor_max: d.test_max,
    iniciar_por: d.test_start_by,
    valor_inicial: d.test_start_by === "max" ? d.test_max : d.test_min,
    intervalo_minutos: d.test_interval_min,
    tempo_espera_minutos: d.test_timeout_min,
    max_tentativas: d.test_max_retries
  }));

  return {
    mqtt: {
      connected: true,
      broker: "163.176.56.133 (Bridge Nuvem WBM)",
      port: 1883,
      username: "wbm_technology",
      client_id: "web-site-cloud",
      msg_count: cloudEngine.recentFeed.length
    },
    access_links: {
      local_url: PUBLIC_WEB_SITE_URL,
      lan_urls: [PUBLIC_WEB_SITE_URL],
      primary_lan_url: PUBLIC_WEB_SITE_URL,
      public_url: PUBLIC_WEB_SITE_URL,
      public_status: "online"
    },
    devices: Object.values(cloudEngine.devicesMap),
    live: cloudEngine.liveMap,
    recent_feed: cloudEngine.recentFeed,
    bot_logs: cloudEngine.botLogs,
    recent_commands: cloudEngine.recentCommands,
    newly_discovered: [],
    known_masters: [],
    config_json: {
      broker: "163.176.56.133",
      porta: 1883,
      username: "wbm_technology",
      password: "Wbm.technology01",
      dispositivos: botDispositivos
    }
  };
}

async function cloudGetDeviceDetail(devId) {
  const cfg = cloudEngine.devicesMap[devId] || CLOUD_DEFAULT_DEVICES[0];
  const lv = cloudEngine.liveMap[devId] || {};
  const [histRows, cmdRows] = await Promise.all([
    cloudRestGet(`controlflow_history?device_id=eq.${encodeURIComponent(devId)}&order=created_at.desc&limit=250`),
    cloudRestGet(`commands_log?device_id=eq.${encodeURIComponent(devId)}&order=requested_at.desc&limit=100`)
  ]);

  const nomMa = Number(cfg.nominal_current_ma || 4000);
  const peakMa = Number(cfg.peak_current_ma || 6500);
  const stallMa = Number(cfg.stall_current_ma || 7000);

  const chron = (histRows || []).slice().reverse();
  let prevPo = null;
  const telHistory = [];
  const errHistory = [];

  for (const r of chron) {
    const po = r.po !== null && r.po !== undefined ? Number(r.po) : prevPo;
    const er = Number(r.er || 0);
    const moved = prevPo !== null && po !== null && Math.abs(po - prevPo) >= 1;
    const curr = er === 3 ? stallMa + 350 : (moved ? (po === 0 || po === 100 ? peakMa : nomMa) : 0);
    prevPo = po;

    telHistory.push({
      device_id: devId,
      device_type: "CF",
      ed: r.ed ?? cfg.ed,
      md: r.md ?? cfg.md,
      po,
      sm: lv.sm,
      qc: r.qc,
      qv: r.qv,
      er,
      corrente: curr,
      media_corrente: nomMa,
      pico_corrente: moved ? peakMa : 0,
      corrente_trava: stallMa,
      created_at: r.created_at,
      source: "cloud_mqtt"
    });

    if (er !== 0) {
      errHistory.unshift({
        device_id: devId,
        error_code: er,
        error_desc: CF_ERRORS[er] || `Erro ${er}`,
        po_at_error: po,
        corrente_at_error: curr,
        started_at: r.created_at,
        resolved_at: null
      });
    }
  }

  const mappedCmds = (cmdRows || []).map(mapSupabaseCmdToAudit);
  for (const c of mappedCmds) {
    if (c.final_po === null && lv.po !== null && isPositionConfirmed(c.sm, lv.po)) {
      c.final_po = lv.po;
      c.pos_confirmed_at = c.ack1_at || c.sent_at;
      c.status = "position_confirmed";
    }
  }

  return {
    config: cfg,
    live: lv,
    telemetry_history: telHistory,
    commands_audit: mappedCmds,
    error_history: errHistory,
    mqtt_feed_history: cloudEngine.recentFeed.filter(f => f.device_id === devId),
    bot_logs_history: cloudEngine.botLogs.filter(l => l.device_id === devId)
  };
}

async function cloudSendCommand(body) {
  await ensureCloudAuth();
  const devId = body.device_id;
  const cfg = cloudEngine.devicesMap[devId] || { device_id: devId, ed: 1, md: 2 };
  const ed = Number(body.ed ?? cfg.ed ?? 1);
  const md = Number(body.md ?? cfg.md ?? 2);
  const sm = Number(body.sm ?? 100);

  cfg.ed = ed;
  cfg.md = md;
  cloudEngine.devicesMap[devId] = cfg;
  saveCloudDevicesToStorage();

  const st = cloudEngine.liveMap[devId];
  if (st) {
    st.ed = ed;
    st.md = md;
    if (sm >= 0 && sm <= 100) {
      st.sm = sm;
      st.pos_verify_state = isPositionConfirmed(sm, st.po) ? "confirmed" : "waiting";
    }
  }

  // Como o firmware M2M.ino extrai o ED prioritariamente do sufixo _CF_<N> do tópico (devices/Mestre_<MAC>_CF_<N>/cmd),
  // garante que o device_id enviado para a bridge corresponda ao ED escolhido pelo usuário!
  let targetBridgeDeviceId = devId;
  const m = devId.match(/^(Mestre_[0-9A-Fa-f]{12})_CF_(\d+)$/i);
  if (m) {
    const masterPrefix = m[1];
    targetBridgeDeviceId = `${masterPrefix}_CF_${ed}`;
  }

  // Garante que targetBridgeDeviceId exista na tabela 'devices' do Supabase antes de inserir em commands_log
  try {
    const checkRows = await cloudRestGet(`devices?device_id=eq.${encodeURIComponent(targetBridgeDeviceId)}&select=device_id`);
    if (!checkRows || checkRows.length === 0) {
      const macMatch = targetBridgeDeviceId.match(/^Mestre_([0-9A-Fa-f]{12})_CF_(\d+)$/i);
      const macAddr = macMatch ? macMatch[1].toUpperCase() : "";
      await cloudRestPost("devices", {
        device_id: targetBridgeDeviceId,
        name: cfg.name || `Control Flow CF_${ed} (MAC ${macAddr})`,
        location: cfg.client || "WBM Technology",
        status: "online",
        solution_code: "control_flow_monitor",
        expected_interval_seconds: 1800,
        master_id: `Mestre_${macAddr}`,
        valve_address: ed,
        master_mac: macAddr,
        device_type: "CF",
        node: ed,
        environment: "production",
        telemetry_mode: "legacy",
        lifecycle_status: "active"
      });
    }
  } catch (_) {}

  // Antes de inserir um novo comando na fila da bridge, finaliza qualquer comando anterior em 'published'/'pending'
  // desse dispositivo para que a bridge externa do Lovable NUNCA fique reenviando infinitamente a cada 20s!
  await cloudFinalizePendingBridgeCommands(targetBridgeDeviceId);

  const inserted = await cloudRestPost("commands_log", {
    device_id: targetBridgeDeviceId,
    command: { ed, md, sm },
    requested_by: cloudEngine.userId,
    status: "pending"
  });
  const cmdId = inserted?.[0]?.id;

  // Assim que a bridge publicar o comando no MQTT (~6s), marca-o como finalizado na fila da bridge
  // para que o controle de número de tentativas (ex: 3 envios) seja feito exclusivamente pelo nosso Bot!
  if (cmdId) {
    setTimeout(async () => {
      try {
        const nowIso = new Date().toISOString();
        await cloudRestPatch(`commands_log?id=eq.${cmdId}&status=eq.published`, {
          status: "confirmed",
          confirmed_at: nowIso,
          superseded_at: nowIso
        });
      } catch (_) {}
    }, 8500);
  }

  const topic = `devices/${targetBridgeDeviceId}/cmd`;
  const msgStr = JSON.stringify({ ed, md, sm });
  if (!body.silentLog) {
    pushCloudBotLog(`🚀 [${devId}] Comando enviado pelo Site Web -> Tópico: ${topic} | Alvo: ${sm}${sm <= 100 ? "%" : ""} (ED: ${ed}, MD: ${md}) | Msg: ${msgStr}`, devId);
  }

  return {
    ok: true,
    result: {
      command_id: cmdId || "cloud-cmd",
      device_id: devId,
      topic,
      payload: { ed, md, sm },
      sent_at: new Date().toISOString()
    }
  };
}

function startCloudBotTimer(devId, params = null, isResume = false) {
  if (params) {
    cloudEngine.devicesMap[devId] = { ...(cloudEngine.devicesMap[devId] || {}), ...params, device_id: devId };
  }
  stopCloudBotTimer(devId, null, true);

  const cfg = cloudEngine.devicesMap[devId];
  const st = cloudEngine.liveMap[devId];
  if (!cfg || !st) return;

  cfg.test_running = true;
  if (!isResume || cfg.test_current_use_max === undefined || cfg.test_current_use_max === null) {
    cfg.test_current_use_max = (cfg.test_start_by || "max") === "max";
  }
  cfg.updated_at = new Date().toISOString();
  saveCloudDevicesToStorage();
  persistCloudDeviceToSupabase(devId);

  const runSessionId = Date.now();
  cloudEngine.botTimers[devId] = { sessionId: runSessionId };
  st.test_running = true;
  if (!isResume) {
    st.test_cycles_done = 0;
    st.test_cycles_ok = 0;
    st.test_cycles_fail = 0;
  }

  let useMax = Boolean(cfg.test_current_use_max);
  pushCloudBotLog(
    `🤖 [${devId} | ED ${cfg.ed}] Bot ${isResume ? "retomado automaticamente" : "iniciado"}! Limites: ${cfg.test_min ?? 1}% a ${cfg.test_max ?? 100}% (Iniciando por: ${useMax ? "Máximo" : "Mínimo"} | Freq: ${cfg.test_interval_min ?? 10} min | Timeout: ${cfg.test_timeout_min ?? 2} min | Nº Envios: ${cfg.test_max_retries ?? 3}).`,
    devId
  );

  const sleepMs = ms => new Promise(r => setTimeout(r, ms));
  const isStillRunning = () => st.test_running && cloudEngine.botTimers[devId]?.sessionId === runSessionId;

  (async () => {
    if (isResume && cfg.test_next_target_epoch_ms && cfg.test_next_target_epoch_ms > Date.now()) {
      const nextSmResume = useMax ? Number(cfg.test_max ?? 100) : Number(cfg.test_min ?? 1);
      while (Date.now() < cfg.test_next_target_epoch_ms) {
        if (!isStillRunning()) break;
        const rem = Math.max(0, Math.ceil((cfg.test_next_target_epoch_ms - Date.now()) / 1000));
        const mins = String(Math.floor(rem / 60)).padStart(2, "0");
        const segs = String(rem % 60).padStart(2, "0");
        st.test_phase = `Próximo envio (${nextSmResume}%) em ${mins}:${segs}`;
        await sleepMs(1000);
      }
    }
    cfg.test_next_target_epoch_ms = null;
    saveCloudDevicesToStorage();

    while (isStillRunning()) {
      try {
        const c = cloudEngine.devicesMap[devId] || cfg;
        const vMin = Number(c.test_min ?? 1);
        const vMax = Number(c.test_max ?? 100);
        const intervalSec = Math.max(5, Math.round(Number(c.test_interval_min ?? 10) * 60));
        const timeoutSec = Math.max(5, Math.round(Number(c.test_timeout_min ?? 2) * 60));
        const maxRetries = Math.max(1, Number(c.test_max_retries ?? 3));
        const targetSm = useMax ? vMax : vMin;
        let confirmed = false;

        // Envia exatamente até maxRetries (Nº de envios configurado) aguardando confirmação
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          if (!isStillRunning()) break;
          st.test_phase = `Enviando ${targetSm}% (Tentativa ${attempt}/${maxRetries})`;
          const sendEpochMs = Date.now();
          try {
            const res = await cloudSendCommand({
              device_id: devId,
              ed: c.ed,
              md: c.md,
              sm: targetSm,
              silentLog: true
            });
            const msgJson = JSON.stringify(res.result.payload);
            if (attempt === 1) {
              pushCloudBotLog(`[${devId}] Envio 1/${maxRetries} -> Tópico: ${res.result.topic} | Alvo: ${targetSm}% | Msg: ${msgJson}`, devId);
            } else {
              pushCloudBotLog(`[${devId}] Reenvio ${attempt}/${maxRetries} -> Alvo: ${targetSm}% | Msg: ${msgJson}`, devId);
            }
          } catch (err) {
            pushCloudBotLog(`[${devId}] Erro ao enviar tentativa ${attempt}/${maxRetries}: ${err.message}`, devId);
          }

          // Aguarda resposta durante timeoutSec segundos
          const waitStartMs = Date.now();
          while (Date.now() - waitStartMs < timeoutSec * 1000) {
            if (!isStillRunning()) break;
            const rem = Math.max(0, Math.ceil((timeoutSec * 1000 - (Date.now() - waitStartMs)) / 1000));
            const mins = String(Math.floor(rem / 60)).padStart(2, "0");
            const segs = String(rem % 60).padStart(2, "0");
            st.test_phase = `Aguardando resp. (${mins}:${segs}) • Alvo ${targetSm}% [Tent. ${attempt}/${maxRetries}]`;

            const lastSeenMs = st.last_seen ? new Date(st.last_seen).getTime() : 0;
            if (lastSeenMs >= sendEpochMs - 3000 && isPositionConfirmed(targetSm, st.po)) {
              confirmed = true;
              break;
            }
            await sleepMs(1000);
          }

          if (confirmed) {
            pushCloudBotLog(`[${devId}] CONFIRMADO: Válvula recebida e posicionada em ${st.po}% (Alvo: ${targetSm}%)!`, devId);
            break;
          } else if (isStillRunning()) {
            const posLida = st.po !== null && st.po !== undefined ? `${st.po}%` : "Sem resposta";
            pushCloudBotLog(
              `[${devId}] Tentativa ${attempt}/${maxRetries} sem confirmação em ${c.test_timeout_min ?? 2} min. Posição: ${posLida} (Esperado: ${targetSm}%)`,
              devId
            );
          }
        }

        if (!isStillRunning()) break;

        st.test_cycles_done = (st.test_cycles_done || 0) + 1;
        if (confirmed) {
          st.pos_verify_state = "confirmed";
          st.test_cycles_ok = (st.test_cycles_ok || 0) + 1;
          pushCloudBotLog(`[${devId}] Ciclo em ${targetSm}% concluído com sucesso. Alternando próximo limite...`, devId);
        } else {
          st.pos_verify_state = "divergent";
          st.test_cycles_fail = (st.test_cycles_fail || 0) + 1;
          pushCloudBotLog(`[${devId}] ALERTA: Não posicionou em ${targetSm}% após ${maxRetries} envio(s). Alternando para próximo limite...`, devId);
        }

        useMax = !useMax;
        const nextSm = useMax ? vMax : vMin;
        const nextTargetMs = Date.now() + intervalSec * 1000;
        if (cloudEngine.devicesMap[devId]) {
          cloudEngine.devicesMap[devId].test_current_use_max = useMax;
          cloudEngine.devicesMap[devId].test_next_target_epoch_ms = nextTargetMs;
          cloudEngine.devicesMap[devId].updated_at = new Date().toISOString();
          saveCloudDevicesToStorage();
          persistCloudDeviceToSupabase(devId);
        }

        pushCloudBotLog(`[${devId}] Aguardando ${c.test_interval_min ?? 10} min para o próximo envio (Próximo alvo: ${nextSm}%)...`, devId);

        while (Date.now() < nextTargetMs) {
          if (!isStillRunning()) break;
          const rem = Math.max(0, Math.ceil((nextTargetMs - Date.now()) / 1000));
          const mins = String(Math.floor(rem / 60)).padStart(2, "0");
          const segs = String(rem % 60).padStart(2, "0");
          st.test_phase = `Próximo envio (${nextSm}%) em ${mins}:${segs}`;
          await sleepMs(1000);
        }
        if (cloudEngine.devicesMap[devId]) {
          cloudEngine.devicesMap[devId].test_next_target_epoch_ms = null;
          saveCloudDevicesToStorage();
        }
      } catch (loopErr) {
        pushCloudBotLog(`[${devId}] Erro transitório no ciclo automático (${loopErr?.message || loopErr}). Mantendo Bot ativo...`, devId);
        await sleepMs(3000);
      }
    }
  })();
}

function stopCloudBotTimer(devId, params = null, silent = false) {
  if (params) {
    cloudEngine.devicesMap[devId] = { ...(cloudEngine.devicesMap[devId] || {}), ...params, device_id: devId };
  }
  if (!silent && cloudEngine.devicesMap[devId]) {
    cloudEngine.devicesMap[devId].test_running = false;
    cloudEngine.devicesMap[devId].test_current_use_max = null;
    cloudEngine.devicesMap[devId].test_next_target_epoch_ms = null;
    cloudEngine.devicesMap[devId].updated_at = new Date().toISOString();
    saveCloudDevicesToStorage();
    persistCloudDeviceToSupabase(devId);
  }
  delete cloudEngine.botTimers[devId];
  const st = cloudEngine.liveMap[devId];
  if (st) {
    st.test_running = false;
    st.test_phase = "Parado";
  }
  cloudFinalizePendingBridgeCommands(devId);
  if (!silent) {
    pushCloudBotLog(`⏹ [${devId}] Automação interrompida pelo usuário no Site Web.`, devId);
  }
}

// ============================================================================
// Comunicação Híbrida: Servidor Local Python (/api/...) OU Site Nuvem Direto
// ============================================================================
async function apiGet(path) {
  if (!cloudEngine.isCloudMode) {
    try {
      const res = await fetch(path);
      if (res.ok) return await res.json();
    } catch (_) {
      cloudEngine.isCloudMode = true;
    }
  }
  if (path === "/api/state") {
    return await cloudBuildState();
  }
  if (path.startsWith("/api/device/detail")) {
    const urlObj = new URL(path, window.location.origin);
    const devId = urlObj.searchParams.get("device_id");
    return await cloudGetDeviceDetail(devId);
  }
  return {};
}

async function apiPost(path, body) {
  if (!cloudEngine.isCloudMode) {
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (!data.error) return data;
      }
    } catch (_) {
      cloudEngine.isCloudMode = true;
    }
  }

  // Fallback 100% Nuvem para quando aberto pelo link do Site (GitHub Pages / Celular 4G)
  if (path === "/api/command") {
    return await cloudSendCommand(body);
  }
  if (path === "/api/devices") {
    const devId = (body.device_id || "").trim();
    const existing = cloudEngine.devicesMap[devId] || {};
    cloudEngine.devicesMap[devId] = {
      ...existing,
      ...body,
      device_id: devId,
      test_running: body.test_running !== undefined ? Boolean(body.test_running) : Boolean(existing.test_running),
      test_current_use_max: body.test_current_use_max !== undefined ? body.test_current_use_max : (existing.test_current_use_max ?? null),
      test_next_target_epoch_ms: body.test_next_target_epoch_ms !== undefined ? body.test_next_target_epoch_ms : (existing.test_next_target_epoch_ms ?? null),
      updated_at: new Date().toISOString()
    };
    saveCloudDevicesToStorage();
    persistCloudDeviceToSupabase(devId);
    return { ok: true, device: cloudEngine.devicesMap[devId] };
  }
  if (path === "/api/devices/delete") {
    stopCloudBotTimer(body.device_id, null, true);
    delete cloudEngine.devicesMap[body.device_id];
    saveCloudDevicesToStorage();
    return { ok: true };
  }
  if (path === "/api/test/start") {
    startCloudBotTimer(body.device_id, body.params);
    return { ok: true, result: { status: "started", device_id: body.device_id } };
  }
  if (path === "/api/test/stop") {
    stopCloudBotTimer(body.device_id, body.params);
    return { ok: true, result: { status: "stopped", device_id: body.device_id } };
  }
  if (path === "/api/test/start_all") {
    const started = Object.keys(cloudEngine.devicesMap);
    started.forEach(id => startCloudBotTimer(id));
    return { ok: true, started };
  }
  if (path === "/api/test/stop_all") {
    const stopped = Object.keys(cloudEngine.devicesMap);
    stopped.forEach(id => stopCloudBotTimer(id));
    return { ok: true, stopped };
  }
  if (path === "/api/device/sync_lovable_metadata") {
    await cloudBuildState();
    return { ok: true, result: { synced_count: Object.keys(cloudEngine.devicesMap).length, total: Object.keys(cloudEngine.devicesMap).length } };
  }
  if (path === "/api/access/public_tunnel") {
    return { ok: true, result: { status: "online", public_url: PUBLIC_WEB_SITE_URL } };
  }
  return { ok: true };
}

async function pollServerState() {
  try {
    const data = await apiGet("/api/state");
    const prevDeviceIds = new Set(state.devices.map(d => d.device_id));

    state.mqtt = data.mqtt || {};
    state.accessLinks = data.access_links || {};
    state.devices = data.devices || [];
    state.live = data.live || {};
    state.recentFeed = data.recent_feed || [];
    state.botLogs = data.bot_logs || [];
    state.recentCommands = data.recent_commands || [];
    state.newlyDiscovered = data.newly_discovered || [];
    state.knownMasters = data.known_masters || [];
    state.configJson = data.config_json || {};

    // Notifica imediatamente se um dispositivo novo (com MAC novo) chegou via tópico no servidor
    if (state.initialLoadDone) {
      for (const dev of state.devices) {
        if (!prevDeviceIds.has(dev.device_id) && dev.auto_discovered) {
          const macInfo = dev.mac ? `MAC Novo: ${dev.mac}` : dev.master_id;
          showToast(`🆕 Novo dispositivo identificado via MQTT: ${dev.device_id} (${macInfo})!`);
        }
      }
    }
    for (const disc of state.newlyDiscovered) {
      const k = `${disc.device_id}_${disc.discovered_at}`;
      if (!state.notifiedDiscoveryKeys.has(k)) {
        state.notifiedDiscoveryKeys.add(k);
        if (state.initialLoadDone) {
          showToast(`🆕 Dispositivo auto-descoberto no servidor: ${disc.device_id} (MAC: ${disc.mac}) no tópico ${disc.topic}`);
        }
      }
    }
    state.initialLoadDone = true;

    updateHeaderStatus();
    renderDeviceTabsBar();
    updateActiveMainViewVisibility();

    if (state.activeView === "automation") {
      renderAutomationBotTab();
    }

    if (!state.selectedDeviceId && state.devices.length > 0) {
      state.selectedDeviceId = state.devices[0].device_id;
    }

    if (state.selectedDeviceId && state.activeView === "device") {
      const shouldPopulate = !state.initialInputsPopulated;
      state.initialInputsPopulated = true;
      await refreshSelectedDeviceDetail(shouldPopulate);
    }
  } catch (err) {
    console.warn("Poll error:", err);
  }
}

function updateHeaderStatus() {
  const dot = document.getElementById("mqtt-dot");
  const txt = document.getElementById("mqtt-status-text");
  if (!dot || !txt) return;

  if (state.mqtt.connected) {
    dot.className = "w-2 h-2 rounded-full bg-[#2ce610] shadow-[0_0_8px_#2ce610]";
    txt.textContent = `MQTT Conectado (${state.mqtt.broker}:${state.mqtt.port} • ID: ${state.mqtt.client_id} • ${state.mqtt.msg_count || 0} pacotes)`;
  } else {
    dot.className = "w-2 h-2 rounded-full bg-rose-500";
    txt.textContent = `MQTT Desconectado (${state.mqtt.last_error || "Tentando reconectar..."})`;
  }
}

// ============================================================================
// Abas: Aba Específica de Automação (Bot) + Abas Exclusivas por Equipamento
// ============================================================================
function updateActiveMainViewVisibility() {
  const autoView = document.getElementById("automation-tab-view");
  const devView = document.getElementById("device-tab-view");
  const autoBtn = document.getElementById("tab-btn-automation");
  const chartsBtn = document.getElementById("tab-btn-charts-report");
  const chartsBadge = document.getElementById("charts-selected-dev-badge");

  const activeCount = state.devices.filter(d => Boolean(state.live[d.device_id]?.test_running)).length;
  const badge = document.getElementById("bot-active-count-badge");
  if (badge) {
    badge.textContent = `${activeCount} ativo${activeCount === 1 ? "" : "s"}`;
    badge.className = activeCount > 0
      ? "px-1.5 py-0.2 text-[10px] font-mono rounded bg-[#2ce610] text-black font-extrabold animate-pulse"
      : "px-1.5 py-0.2 text-[10px] font-mono rounded bg-wbm-black border border-wbm-border text-wbm-green";
  }

  if (chartsBadge) {
    const selDev = state.devices.find(d => d.device_id === state.selectedDeviceId) || state.devices[0];
    chartsBadge.textContent = selDev ? `ED ${selDev.ed}` : "Auditoria";
  }

  if (state.activeView === "automation") {
    autoView?.classList.remove("hidden");
    devView?.classList.add("hidden");
    if (autoBtn) {
      autoBtn.className = "px-4 py-2 rounded-xl border text-left transition-all flex items-center gap-2.5 shrink-0 bg-[#2ce610]/15 border-[#2ce610] text-white shadow-[0_0_16px_rgba(44,230,16,0.16)]";
    }
    if (chartsBtn) {
      chartsBtn.className = "px-4 py-2 rounded-xl border text-left transition-all flex items-center gap-2.5 shrink-0 bg-wbm-surface border-wbm-border text-zinc-300 hover:text-white hover:border-wbm-green";
    }
  } else {
    autoView?.classList.add("hidden");
    devView?.classList.remove("hidden");
    if (autoBtn) {
      autoBtn.className = "px-4 py-2 rounded-xl border text-left transition-all flex items-center gap-2.5 shrink-0 bg-wbm-surface border-wbm-border text-zinc-300 hover:text-white hover:border-wbm-green";
    }
    if (chartsBtn) {
      chartsBtn.className = "px-4 py-2 rounded-xl border text-left transition-all flex items-center gap-2.5 shrink-0 bg-[#2ce610]/15 border-[#2ce610] text-white shadow-[0_0_16px_rgba(44,230,16,0.16)]";
    }
  }
}

async function selectChartsAndReportTab() {
  const targetId = state.selectedDeviceId || (state.devices[0] && state.devices[0].device_id);
  if (targetId) {
    await selectDeviceTab(targetId);
  } else {
    state.activeView = "device";
    localStorage.setItem("wbm_cf_active_view", "device");
    updateActiveMainViewVisibility();
    renderDeviceTabsBar();
  }
}

function selectAutomationTab() {
  state.activeView = "automation";
  localStorage.setItem("wbm_cf_active_view", "automation");
  updateActiveMainViewVisibility();
  renderDeviceTabsBar();
  renderAutomationBotTab();
}

function extractMacFromDevice(dev) {
  if (dev.mac) return dev.mac;
  const m = String(dev.device_id || dev.master_id || "").match(/([0-9A-Fa-f]{12})/);
  return m ? m[1].toUpperCase() : "";
}

function renderDeviceTabsBar() {
  const container = document.getElementById("device-tabs-container");
  if (container) {
    container.innerHTML = state.devices.map(dev => {
      const isSel = state.activeView === "device" && dev.device_id === state.selectedDeviceId;
      const lv = state.live[dev.device_id] || {};
      const er = Number(lv.er || 0);
      const isRunning = Boolean(lv.test_running);
      const isAutoDisc = Boolean(dev.auto_discovered || (dev.client && dev.client.includes("Auto-Descoberto")));
      const mac = extractMacFromDevice(dev);

      let dotClass = "bg-[#2ce610]";
      if (er !== 0) dotClass = "bg-rose-500 animate-ping";
      else if (!lv.last_seen) dotClass = "bg-zinc-500";

      const posBadge = dev.type === "MP"
        ? (lv.pressao !== null && lv.pressao !== undefined ? `${Number(lv.pressao).toFixed(2)} bar` : "---")
        : (lv.po !== null && lv.po !== undefined ? `${lv.po}%` : "---%");

      return `
        <button
          type="button"
          onclick="selectDeviceTab('${dev.device_id}')"
          class="px-3.5 py-2 rounded-xl border text-left transition-all flex items-center gap-2.5 shrink-0 ${
            isSel
              ? "bg-[#2ce610]/15 border-[#2ce610] text-white shadow-[0_0_16px_rgba(44,230,16,0.16)]"
              : "bg-wbm-surface border-wbm-border text-zinc-400 hover:text-white hover:border-zinc-600"
          }"
        >
          <span class="w-2 h-2 rounded-full ${dotClass}"></span>
          <div>
            <div class="text-xs font-extrabold flex items-center gap-1.5">
              <span>${escapeHtml(dev.name)}</span>
              <span class="px-1.5 py-0.2 text-[10px] font-mono rounded bg-wbm-black border border-wbm-border text-wbm-green">
                ${escapeHtml(posBadge)}
              </span>
              ${isAutoDisc ? `<span class="px-1.5 py-0.2 text-[10px] font-extrabold rounded bg-amber-500/20 text-amber-300 border border-amber-400/30">🆕 NOVO MAC</span>` : ""}
              ${isRunning ? `<span class="px-1.5 py-0.2 text-[10px] rounded bg-sky-500/20 text-sky-300 animate-pulse">TESTE ATIVO</span>` : ""}
            </div>
            <div class="text-[10px] font-mono text-zinc-400">
              ${escapeHtml(dev.device_id)} ${mac ? `• MAC: ${escapeHtml(mac)}` : ""} • ED ${dev.ed}
            </div>
          </div>
        </button>
      `;
    }).join("");
  }

  renderChartsDeviceSelector();
}

function renderChartsDeviceSelector() {
  const selectEl = document.getElementById("charts-device-select");
  const gridEl = document.getElementById("charts-devices-selector-grid");

  if (selectEl) {
    selectEl.innerHTML = state.devices.map(dev => {
      const lv = state.live[dev.device_id] || {};
      const poTxt = lv.po !== null && lv.po !== undefined ? `${lv.po}%` : "---%";
      const selAttr = dev.device_id === state.selectedDeviceId ? "selected" : "";
      return `<option value="${escapeHtml(dev.device_id)}" ${selAttr}>${escapeHtml(dev.name)} • ${escapeHtml(dev.device_id)} (ED ${dev.ed} | Pos: ${poTxt})</option>`;
    }).join("");
  }

  if (gridEl) {
    gridEl.innerHTML = state.devices.map(dev => {
      const isSel = dev.device_id === state.selectedDeviceId;
      const lv = state.live[dev.device_id] || {};
      const er = Number(lv.er || 0);
      const po = lv.po !== null && lv.po !== undefined ? `${lv.po}%` : "---%";
      const sm = lv.sm !== null && lv.sm !== undefined ? `${lv.sm}%` : "---%";
      const mac = extractMacFromDevice(dev);
      const age = formatAge(lv.last_seen);
      const isRunning = Boolean(lv.test_running);

      let statusBadge = `<span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-500/15 text-emerald-400">● OK</span>`;
      if (er !== 0) {
        statusBadge = `<span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-rose-500/20 text-rose-400">● ERRO ${er}</span>`;
      } else if (!lv.last_seen) {
        statusBadge = `<span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-zinc-800 text-zinc-400">● Sem leitura</span>`;
      }

      return `
        <button
          type="button"
          onclick="selectDeviceTab('${dev.device_id}')"
          class="p-3.5 rounded-xl border text-left transition-all flex flex-col justify-between gap-2.5 ${
            isSel
              ? "bg-[#2ce610]/15 border-[#2ce610] text-white shadow-[0_0_18px_rgba(44,230,16,0.18)]"
              : "bg-wbm-black border-wbm-border text-zinc-300 hover:border-wbm-green/60 hover:bg-wbm-card"
          }"
        >
          <div class="flex items-start justify-between gap-2 w-full">
            <div class="min-w-0">
              <div class="text-xs font-extrabold text-white truncate">${escapeHtml(dev.name)}</div>
              <div class="text-[11px] text-zinc-400 truncate">${escapeHtml(dev.client || "WBM Technology")}</div>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              ${isSel ? `<span class="px-2 py-0.5 text-[10px] font-extrabold rounded bg-[#2ce610] text-black">SELECIONADO</span>` : statusBadge}
            </div>
          </div>

          <div class="grid grid-cols-3 gap-1.5 pt-1 border-t border-wbm-border/60 text-[11px] w-full">
            <div>
              <span class="text-zinc-500 block text-[10px]">Posição (po)</span>
              <strong class="font-mono text-wbm-green">${escapeHtml(po)}</strong>
            </div>
            <div>
              <span class="text-zinc-500 block text-[10px]">Alvo (sm)</span>
              <strong class="font-mono text-sky-400">${escapeHtml(sm)}</strong>
            </div>
            <div>
              <span class="text-zinc-500 block text-[10px]">Nó / Status</span>
              <strong class="font-mono text-zinc-200">ED ${dev.ed}</strong>
            </div>
          </div>

          <div class="flex items-center justify-between text-[10px] font-mono text-zinc-400 w-full">
            <span class="truncate">${escapeHtml(dev.device_id)}</span>
            <span class="shrink-0 ${isRunning ? "text-sky-300 font-bold" : ""}">${isRunning ? "⚡ Bot Ativo" : escapeHtml(age.text)}</span>
          </div>
        </button>
      `;
    }).join("");
  }
}

async function selectDeviceTab(deviceId) {
  state.activeView = "device";
  localStorage.setItem("wbm_cf_active_view", "device");
  state.selectedDeviceId = deviceId;
  state.reportDirty = false;
  localStorage.setItem("wbm_cf_selected_tab", deviceId);
  updateActiveMainViewVisibility();
  renderDeviceTabsBar();
  await refreshSelectedDeviceDetail(true);
}

// ============================================================================
// Renderização e Controle da Aba Específica de Automação de Comandos (Bot)
// ============================================================================
function renderAutomationBotTab() {
  const grid = document.getElementById("bot-devices-cards-grid");
  if (!grid) return;

  // Verifica se o usuário está digitando em algum input dentro dos cards do bot para não perder o foco
  const activeEl = document.activeElement;
  const isTypingInBotGrid = activeEl && grid.contains(activeEl) && (activeEl.tagName === "INPUT" || activeEl.tagName === "SELECT");

  if (!isTypingInBotGrid) {
    // Preserva os valores já digitados pelo usuário nos campos manuais e automáticos antes de re-renderizar
    const preservedInputs = {};
    grid.querySelectorAll("input, select").forEach(el => {
      if (el.id) preservedInputs[el.id] = el.value;
    });

    grid.innerHTML = state.devices.map(dev => {
      const devId = dev.device_id;
      const lv = state.live[devId] || {};
      const isRunning = Boolean(lv.test_running);
      const po = lv.po !== null && lv.po !== undefined ? Number(lv.po) : null;
      const sm = lv.sm !== null && lv.sm !== undefined ? Number(lv.sm) : null;
      const er = Number(lv.er || 0);
      const age = formatAge(lv.last_seen);
      const confirmed = isPositionConfirmed(sm, po);
      const verifyState = lv.pos_verify_state || "idle";

      let cmpText = "Aguardando envio...";
      let cmpClass = "text-zinc-400";
      if (po === null && sm === null) {
        cmpText = "Aguardando envio...";
        cmpClass = "text-zinc-400";
      } else if (po === null) {
        cmpText = "Sem leitura de telemetria";
        cmpClass = "text-amber-400";
      } else if (verifyState === "divergent") {
        // Somente aparece como DIVERGENTE quando esgotou as tentativas e o tempo de espera sem confirmar
        cmpText = `⚠ DIVERGENTE (Sem confirmação após tentativas • Atual: ${po}% != Alvo: ${sm}%)`;
        cmpClass = "text-rose-400";
      } else if (confirmed || verifyState === "confirmed") {
        cmpText = `✓ RECEBIDO E POSICIONADO (${po}% == Alvo ${sm ?? po}%)`;
        cmpClass = "text-[#2ce610]";
      } else if (verifyState === "waiting" || isRunning) {
        cmpText = `⏳ AGUARDANDO CONFIRMAÇÃO / EM MOVIMENTO (Atual: ${po}% → Alvo: ${sm}%)`;
        cmpClass = "text-amber-300";
      } else {
        cmpText = `✓ POSICIONADO (${po}%)`;
        cmpClass = "text-[#2ce610]";
      }

      let hwStatusText = "Aguardando...";
      let hwStatusClass = "text-sky-400";
      if (er !== 0) {
        hwStatusText = `FALHA (ERRO ${er})`;
        hwStatusClass = "text-rose-500";
      } else if (verifyState === "divergent") {
        hwStatusText = "DIVERGENTE (TIMEOUT)";
        hwStatusClass = "text-rose-400";
      } else if (confirmed || verifyState === "confirmed" || verifyState === "synced") {
        hwStatusText = "POSICIONADO OK";
        hwStatusClass = "text-[#2ce610]";
      } else if (lv.last_seen) {
        hwStatusText = "EM MOVIMENTO";
        hwStatusClass = "text-amber-300";
      }

      const safeId = devId.replace(/[^a-zA-Z0-9_-]/g, "_");
      const mac = extractMacFromDevice(dev);
      const isAutoDisc = Boolean(dev.auto_discovered || (dev.client && dev.client.includes("Auto-Descoberto")));
      const cardMode = state.deviceCommandModes[devId] || "auto"; // 'auto' | 'manual'

      return `
        <div class="rounded-2xl bg-wbm-surface border ${isRunning ? "border-[#2ce610] shadow-[0_0_24px_rgba(44,230,16,0.12)]" : "border-wbm-border"} p-5 flex flex-col gap-4">
          <!-- Topo da Aba da Válvula -->
          <div class="flex flex-wrap items-center justify-between gap-3 border-b border-wbm-border pb-3">
            <div>
              <div class="flex items-center gap-2 flex-wrap">
                <span class="px-2 py-0.5 text-[10px] font-extrabold rounded bg-wbm-green text-black">
                  ABA VÁLVULA
                </span>
                <span class="font-mono font-extrabold text-sm text-wbm-green">${escapeHtml(devId)} (ED ${dev.ed})</span>
                ${mac ? `<span class="px-2 py-0.5 text-[10px] font-mono font-bold rounded bg-wbm-black border border-wbm-border text-sky-300">MAC: ${escapeHtml(mac)}</span>` : ""}
                ${isAutoDisc ? `<span class="px-2 py-0.5 text-[10px] font-extrabold rounded bg-amber-500/20 text-amber-300 border border-amber-400/30">🆕 AUTO-DESCOBERTO</span>` : ""}
              </div>
              <div class="text-xs font-bold text-white mt-0.5">${escapeHtml(dev.name)} • <span class="text-zinc-400 font-normal">${escapeHtml(dev.client || "")}</span></div>
            </div>

            <div class="flex items-center gap-2">
              <button
                onclick="selectDeviceTab('${devId}')"
                class="px-3 py-1.5 rounded-lg bg-wbm-black hover:bg-wbm-card border border-wbm-border text-[11px] font-semibold text-zinc-300 transition"
                title="Abrir gráficos históricos e relatório desta válvula"
              >
                📊 Ver Gráficos &amp; Relatório
              </button>
              <button
                onclick="removeBotDeviceCard('${devId}')"
                class="px-2.5 py-1.5 rounded-lg bg-rose-950/50 hover:bg-rose-900/70 border border-rose-500/30 text-[11px] font-semibold text-rose-300 transition"
                title="Remover esta aba de válvula"
              >
                ✕
              </button>
            </div>
          </div>

          <!-- SELETOR DE MODO DO DISPOSITIVO: AUTOMÁTICO (BOT CÍCLICO) vs MANUAL (ENVIO IMEDIATO) -->
          <div class="flex items-center justify-between gap-2 p-1.5 rounded-xl bg-wbm-black border border-wbm-border">
            <button
              type="button"
              onclick="setDeviceCardMode('${devId}', 'auto')"
              class="flex-1 py-2 px-3 rounded-lg text-xs font-extrabold transition flex items-center justify-center gap-2 ${
                cardMode === "auto"
                  ? "bg-[#2ce610] text-black shadow-[0_0_14px_rgba(44,230,16,0.3)]"
                  : "text-zinc-400 hover:text-white hover:bg-wbm-surface"
              }"
            >
              <span>🤖 Modo Automático (Bot Cíclico)</span>
            </button>
            <button
              type="button"
              onclick="setDeviceCardMode('${devId}', 'manual')"
              class="flex-1 py-2 px-3 rounded-lg text-xs font-extrabold transition flex items-center justify-center gap-2 ${
                cardMode === "manual"
                  ? "bg-sky-400 text-black shadow-[0_0_14px_rgba(56,189,248,0.3)]"
                  : "text-zinc-400 hover:text-white hover:bg-wbm-surface"
              }"
            >
              <span>🎛️ Modo Manual (Envio Imediato)</span>
            </button>
          </div>

          <!-- Bloco 1: Telemetria e Verificação da Válvula (Servidor MQTT) -->
          <div class="p-3.5 rounded-xl bg-wbm-black border border-wbm-border space-y-2 text-xs">
            <div class="text-[10px] font-bold uppercase tracking-wider text-zinc-400 border-b border-wbm-border/60 pb-1">
              Telemetria e Verificação da Válvula (Servidor MQTT)
            </div>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
              <div>
                <div class="text-[10px] text-zinc-500">Status Hardware:</div>
                <div class="font-extrabold ${hwStatusClass}">${escapeHtml(hwStatusText)}</div>
              </div>
              <div>
                <div class="text-[10px] text-zinc-500">Última Atualização:</div>
                <div class="font-mono text-zinc-200">${escapeHtml(lv.last_seen ? `${formatTimeShort(lv.last_seen)} (${age.text})` : "Nenhum dado")}</div>
              </div>
              <div>
                <div class="text-[10px] text-zinc-500">Posição Atual Válvula (po):</div>
                <div class="font-mono text-sm font-extrabold text-white">${po !== null ? `${po}%` : "---"}</div>
              </div>
              <div>
                <div class="text-[10px] text-zinc-500">Último Alvo Enviado (sm):</div>
                <div class="font-mono text-sm font-extrabold text-sky-400">${sm !== null ? `${sm}% (ED: ${dev.ed})` : `--- (ED: ${dev.ed})`}</div>
              </div>
              <div class="col-span-2">
                <div class="text-[10px] text-zinc-500">Verificação Posicionamento:</div>
                <div class="font-extrabold ${cmpClass}">${escapeHtml(cmpText)}</div>
              </div>
              <div>
                <div class="text-[10px] text-zinc-500">Ciclos (qc) / Voltas (qv):</div>
                <div class="font-mono text-zinc-200">${lv.qc ?? "---"} / ${lv.qv ?? "---"}</div>
              </div>
              <div>
                <div class="text-[10px] text-zinc-500">Código Erro (er):</div>
                <div class="font-bold ${er === 0 ? "text-[#2ce610]" : "text-rose-500"}">${er === 0 ? "Nenhum (0)" : `ERRO ${er}`}</div>
              </div>
            </div>
          </div>

          <!-- OPÇÃO A: MODO AUTOMÁTICO (BOT CÍCLICO COM TEMPOS E LIMITES) -->
          <div class="${cardMode === "auto" ? "flex flex-col gap-4" : "hidden"}">
            <div class="p-4 rounded-xl bg-wbm-black border border-wbm-border space-y-3 text-xs">
              <div class="flex items-center justify-between border-b border-wbm-border/60 pb-1.5">
                <span class="text-[10px] font-bold uppercase tracking-wider text-wbm-green">
                  🤖 Configurações de Envio Automático e Limites (%)
                </span>
                <span class="text-[10px] font-mono text-zinc-400">
                  Tópico: devices/${escapeHtml(dev.master_id ? `${dev.master_id}_CF_${dev.ed ?? 1}` : devId)}/cmd
                </span>
              </div>

              <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label class="block text-[11px] font-semibold text-zinc-300 mb-1">ED do Equipamento (ed)</label>
                  <input id="bcard-ed-${safeId}" type="number" min="1" max="20" value="${dev.ed ?? 1}" oninput="scheduleAutoSaveBotCardInput('${devId}', '${safeId}')" onchange="autoSaveBotCardInput('${devId}', '${safeId}')" class="w-full px-2.5 py-2 rounded-lg bg-wbm-surface border border-wbm-border font-mono text-white text-center focus:border-wbm-green focus:outline-none" />
                </div>

                <div>
                  <label class="block text-[11px] font-semibold text-zinc-300 mb-1">Modo (md • padrão 2)</label>
                  <input id="bcard-md-${safeId}" type="number" min="1" max="2" value="${dev.md ?? 2}" oninput="scheduleAutoSaveBotCardInput('${devId}', '${safeId}')" onchange="autoSaveBotCardInput('${devId}', '${safeId}')" class="w-full px-2.5 py-2 rounded-lg bg-wbm-surface border border-wbm-border font-mono text-white text-center focus:border-wbm-green focus:outline-none" />
                </div>

                <div>
                  <label class="block text-[11px] font-semibold text-zinc-300 mb-1">Limite Mínimo (%)</label>
                  <input id="bcard-min-${safeId}" type="number" min="0" max="100" value="${dev.test_min ?? 1}" oninput="scheduleAutoSaveBotCardInput('${devId}', '${safeId}')" onchange="autoSaveBotCardInput('${devId}', '${safeId}')" class="w-full px-2.5 py-2 rounded-lg bg-wbm-surface border border-wbm-border font-mono font-bold text-sky-400 text-center focus:border-wbm-green focus:outline-none" />
                </div>

                <div>
                  <label class="block text-[11px] font-semibold text-zinc-300 mb-1">Limite Máximo (%)</label>
                  <input id="bcard-max-${safeId}" type="number" min="0" max="100" value="${dev.test_max ?? 100}" oninput="scheduleAutoSaveBotCardInput('${devId}', '${safeId}')" onchange="autoSaveBotCardInput('${devId}', '${safeId}')" class="w-full px-2.5 py-2 rounded-lg bg-wbm-surface border border-wbm-border font-mono font-bold text-wbm-green text-center focus:border-wbm-green focus:outline-none" />
                </div>

                <div>
                  <label class="block text-[11px] font-semibold text-zinc-300 mb-1">Iniciar pelo Limite</label>
                  <select id="bcard-start-${safeId}" onchange="autoSaveBotCardInput('${devId}', '${safeId}')" class="w-full px-2.5 py-2 rounded-lg bg-wbm-surface border border-wbm-border text-white text-center focus:border-wbm-green focus:outline-none">
                    <option value="min" ${(dev.test_start_by || "max") === "min" ? "selected" : ""}>Mínimo</option>
                    <option value="max" ${(dev.test_start_by || "max") === "max" ? "selected" : ""}>Máximo</option>
                  </select>
                </div>

                <div>
                  <label class="block text-[11px] font-semibold text-zinc-300 mb-1">Frequência Envio (MIN)</label>
                  <input id="bcard-int-${safeId}" type="number" step="0.5" min="0.1" value="${dev.test_interval_min ?? 10}" oninput="scheduleAutoSaveBotCardInput('${devId}', '${safeId}')" onchange="autoSaveBotCardInput('${devId}', '${safeId}')" class="w-full px-2.5 py-2 rounded-lg bg-wbm-surface border border-wbm-border font-mono text-white text-center focus:border-wbm-green focus:outline-none" />
                </div>

                <div>
                  <label class="block text-[11px] font-semibold text-zinc-300 mb-1">Tempo Máx. Resp. (MIN)</label>
                  <input id="bcard-ver-${safeId}" type="number" step="0.5" min="0.1" value="${dev.test_timeout_min ?? 2}" oninput="scheduleAutoSaveBotCardInput('${devId}', '${safeId}')" onchange="autoSaveBotCardInput('${devId}', '${safeId}')" class="w-full px-2.5 py-2 rounded-lg bg-wbm-surface border border-wbm-border font-mono text-white text-center focus:border-wbm-green focus:outline-none" />
                </div>

                <div>
                  <label class="block text-[11px] font-semibold text-zinc-300 mb-1">Nº Envios até Resposta</label>
                  <input id="bcard-tent-${safeId}" type="number" min="1" max="10" value="${dev.test_max_retries ?? 3}" oninput="scheduleAutoSaveBotCardInput('${devId}', '${safeId}')" onchange="autoSaveBotCardInput('${devId}', '${safeId}')" class="w-full px-2.5 py-2 rounded-lg bg-wbm-surface border border-wbm-border font-mono text-white text-center focus:border-wbm-green focus:outline-none" />
                </div>
              </div>
            </div>

            <!-- Contador Regressivo e Botões Iniciar / Parar / Salvar Config -->
            <div class="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div class="flex items-center gap-2 text-xs">
                <span class="font-bold text-zinc-400">Próximo envio / Status:</span>
                <span id="bcard-timer-${safeId}" class="font-mono font-extrabold ${isRunning ? "text-[#2ce610]" : "text-zinc-400"}">
                  ${escapeHtml(lv.test_phase || "Aguardando...")}
                </span>
              </div>

              <div class="flex items-center gap-2">
                <button
                  onclick="startBotCardDevice('${devId}', '${safeId}')"
                  ${isRunning ? "disabled" : ""}
                  class="px-4 py-2 rounded-xl font-extrabold text-xs transition ${
                    isRunning
                      ? "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                      : "bg-[#2ce610] hover:bg-[#3dff21] text-black shadow-md"
                  }"
                >
                  ▶ Iniciar Bot
                </button>

                <button
                  onclick="stopBotCardDevice('${devId}', '${safeId}')"
                  ${!isRunning ? "disabled" : ""}
                  class="px-4 py-2 rounded-xl font-extrabold text-xs transition ${
                    !isRunning
                      ? "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                      : "bg-rose-600 hover:bg-rose-500 text-white shadow-md"
                  }"
                >
                  ⏹ Parar
                </button>

                <button
                  onclick="saveBotCardDevice('${devId}', '${safeId}')"
                  class="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-extrabold text-xs transition"
                >
                  💾 Salvar Config
                </button>
              </div>
            </div>
          </div>

          <!-- OPÇÃO B: MODO MANUAL (ENVIO IMEDIATO SEM TEMPO DE ESPERA OU INTERVALO) -->
          <div class="${cardMode === "manual" ? "flex flex-col gap-4" : "hidden"}">
            <div class="p-4 rounded-xl bg-wbm-black border border-sky-500/30 space-y-3.5 text-xs">
              <div class="flex items-center justify-between border-b border-wbm-border/60 pb-1.5">
                <span class="text-[10px] font-bold uppercase tracking-wider text-sky-400">
                  🎛️ Envio Manual Imediato (Sem Tempo de Espera / Sem Intervalo)
                </span>
                <span class="text-[10px] font-mono text-zinc-400">
                  Tópico: devices/${escapeHtml(dev.master_id ? `${dev.master_id}_CF_${dev.ed ?? 1}` : devId)}/cmd
                </span>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label class="block text-[11px] font-semibold text-zinc-300 mb-1">ED do Equipamento (ed)</label>
                  <input id="mcard-ed-${safeId}" type="number" min="1" max="20" value="${dev.ed ?? 1}" oninput="scheduleAutoSaveManualCard('${devId}', '${safeId}')" onchange="saveManualBotCardDevice('${devId}', '${safeId}', true)" class="w-full px-3 py-2 rounded-lg bg-wbm-surface border border-wbm-border font-mono text-white text-center focus:border-sky-400 focus:outline-none" />
                </div>

                <div>
                  <label class="block text-[11px] font-semibold text-zinc-300 mb-1">Modo Operação (md)</label>
                  <select id="mcard-md-${safeId}" onchange="saveManualBotCardDevice('${devId}', '${safeId}', true)" class="w-full px-3 py-2 rounded-lg bg-wbm-surface border border-wbm-border text-white text-center focus:border-sky-400 focus:outline-none">
                    <option value="2" ${(dev.md ?? 2) === 2 ? "selected" : ""}>2 - Manual (Remoto)</option>
                    <option value="1" ${(dev.md ?? 2) === 1 ? "selected" : ""}>1 - Automático</option>
                  </select>
                </div>

                <div>
                  <label class="block text-[11px] font-semibold text-sky-300 mb-1">Valor do Comando / Setpoint (sm)</label>
                  <input
                    id="mcard-sm-${safeId}"
                    type="number"
                    min="0"
                    max="1000"
                    value="${state.manualSmValues[devId] ?? (sm !== null && sm <= 100 ? sm : 100)}"
                    placeholder="Digite o valor (0 a 100%)"
                    oninput="saveManualSmValue('${devId}', this.value)"
                    onkeydown="if(event.key==='Enter'){event.preventDefault();sendManualBotCardCommand('${devId}','${safeId}');}"
                    class="w-full px-3 py-2 rounded-lg bg-wbm-surface border border-sky-400/50 font-mono font-extrabold text-sm text-sky-300 text-center focus:border-sky-400 focus:outline-none"
                  />
                </div>
              </div>

              <!-- Atalhos Rápidos de Posição e Comandos Especiais -->
              <div class="space-y-2 pt-1">
                <div class="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  Envio Rápido com 1 Clique (Posição % ou Comando Especial):
                </div>
                <div class="grid grid-cols-5 gap-1.5">
                  <button type="button" onclick="sendManualBotCardCommand('${devId}', '${safeId}', 1)" class="py-1.5 rounded-lg bg-wbm-surface hover:bg-wbm-card border border-wbm-border font-mono font-bold text-zinc-200 transition">1%</button>
                  <button type="button" onclick="sendManualBotCardCommand('${devId}', '${safeId}', 25)" class="py-1.5 rounded-lg bg-wbm-surface hover:bg-wbm-card border border-wbm-border font-mono font-bold text-zinc-200 transition">25%</button>
                  <button type="button" onclick="sendManualBotCardCommand('${devId}', '${safeId}', 50)" class="py-1.5 rounded-lg bg-wbm-surface hover:bg-wbm-card border border-wbm-border font-mono font-bold text-zinc-200 transition">50%</button>
                  <button type="button" onclick="sendManualBotCardCommand('${devId}', '${safeId}', 75)" class="py-1.5 rounded-lg bg-wbm-surface hover:bg-wbm-card border border-wbm-border font-mono font-bold text-zinc-200 transition">75%</button>
                  <button type="button" onclick="sendManualBotCardCommand('${devId}', '${safeId}', 100)" class="py-1.5 rounded-lg bg-wbm-surface hover:bg-wbm-card border border-wbm-green/40 font-mono font-bold text-wbm-green transition">100%</button>
                </div>
                <div class="grid grid-cols-3 gap-1.5">
                  <button type="button" onclick="sendManualBotCardCommand('${devId}', '${safeId}', 150)" class="py-1.5 px-2 rounded-lg bg-wbm-surface hover:bg-wbm-card border border-wbm-border text-[10px] text-sky-300 font-semibold transition">SM 150 (Cancela)</button>
                  <button type="button" onclick="sendManualBotCardCommand('${devId}', '${safeId}', 250)" class="py-1.5 px-2 rounded-lg bg-wbm-surface hover:bg-wbm-card border border-wbm-border text-[10px] text-amber-300 font-semibold transition">SM 250 (Reset Erro)</button>
                  <button type="button" onclick="sendManualBotCardCommand('${devId}', '${safeId}', 500)" class="py-1.5 px-2 rounded-lg bg-wbm-surface hover:bg-wbm-card border border-wbm-border text-[10px] text-wbm-green font-semibold transition">SM 500 (Forçar Atual.)</button>
                </div>
              </div>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-3 pt-1">
              <span class="text-[11px] text-zinc-400">
                Publica <code class="font-mono text-zinc-300">{"ed":N,"md":M,"sm":X}</code> instantaneamente no servidor MQTT
              </span>
              <div class="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onclick="saveManualBotCardDevice('${devId}', '${safeId}')"
                  class="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-extrabold text-xs transition shadow-md"
                >
                  💾 Salvar Config
                </button>
                <button
                  type="button"
                  onclick="sendManualBotCardCommand('${devId}', '${safeId}')"
                  class="px-5 py-2.5 rounded-xl bg-sky-400 hover:bg-sky-300 text-black font-extrabold text-xs shadow-lg transition flex items-center gap-1.5"
                >
                  🚀 Enviar Comando Agora
                </button>
              </div>
            </div>
          </div>

          <!-- HISTÓRICO INDIVIDUAL DESTE DISPOSITIVO (TÓPICOS MQTT & COMANDOS) -->
          <div class="p-3.5 rounded-xl bg-wbm-black border border-wbm-border space-y-2.5 text-xs">
            <div class="flex flex-wrap items-center justify-between gap-2 border-b border-wbm-border/60 pb-2">
              <div class="flex items-center gap-1.5">
                <span class="text-[10px] font-extrabold uppercase tracking-wider text-wbm-green">
                  📜 Histórico Individual (${escapeHtml(devId)})
                </span>
              </div>
              <div class="flex items-center gap-1 bg-wbm-surface p-0.5 rounded-lg border border-wbm-border">
                <button
                  type="button"
                  onclick="setCardHistoryTab('${devId}', 'commands')"
                  class="px-2.5 py-1 rounded-md text-[10px] font-extrabold transition ${
                    (state.cardHistoryTabs[devId] || "commands") === "commands"
                      ? "bg-[#2ce610] text-black"
                      : "text-zinc-400 hover:text-white"
                  }"
                >
                  📑 Comandos &amp; Ciclos (${state.recentCommands.filter(c => c.device_id === devId).length + state.botLogs.filter(l => l.device_id === devId).length})
                </button>
                <button
                  type="button"
                  onclick="setCardHistoryTab('${devId}', 'topics')"
                  class="px-2.5 py-1 rounded-md text-[10px] font-extrabold transition ${
                    (state.cardHistoryTabs[devId] || "commands") === "topics"
                      ? "bg-amber-400 text-black"
                      : "text-zinc-400 hover:text-white"
                  }"
                >
                  📡 Tópicos MQTT (${state.recentFeed.filter(f => f.device_id === devId || (dev.master_id && f.device_id === dev.master_id)).length})
                </button>
              </div>
            </div>

            <!-- Conteúdo do Histórico Individual no Card -->
            <div class="font-mono text-[11px] space-y-1.5 max-h-[165px] min-h-[115px] overflow-y-auto pr-1">
              ${renderCardIndividualHistoryHTML(dev)}
            </div>
          </div>
        </div>
      `;
    }).join("");

    // Restaura todos os valores em edição ou recém-alterados nos inputs/selects do card (incluindo 'Iniciar pelo Limite')
    Object.entries(preservedInputs).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (el && val !== undefined && val !== "") {
        el.value = val;
      }
    });
  } else {
    // Atualiza apenas os contadores ao vivo sem recriar os inputs enquanto o usuário digita
    for (const dev of state.devices) {
      const safeId = dev.device_id.replace(/[^a-zA-Z0-9_-]/g, "_");
      const timerEl = document.getElementById(`bcard-timer-${safeId}`);
      if (timerEl) {
        const lv = state.live[dev.device_id] || {};
        timerEl.textContent = lv.test_phase || "Aguardando...";
      }
    }
  }

  // Atualiza campos de conexão e preview do config.json (se o usuário não estiver editando o textarea)
  if (!state.editingConfigJson) {
    const bHost = document.getElementById("bot-cfg-broker");
    const bPort = document.getElementById("bot-cfg-porta");
    const bUser = document.getElementById("bot-cfg-user");
    const jsonArea = document.getElementById("bot-config-json-textarea");

    if (bHost && document.activeElement !== bHost) bHost.value = state.mqtt.broker || "163.176.56.133";
    if (bPort && document.activeElement !== bPort) bPort.value = state.mqtt.port || 1883;
    if (bUser && document.activeElement !== bUser) bUser.value = state.mqtt.username || "wbm_technology";
    if (jsonArea && state.configJson) {
      jsonArea.value = JSON.stringify(state.configJson, null, 4);
    }
  }

  // Atualiza Painel de Histórico Geral (Logs de Comandos, Feed Geral de Tópicos MQTT e Tabela Geral de Auditoria)
  renderGlobalHistoryPanel();
}

function setCardHistoryTab(devId, tab) {
  state.cardHistoryTabs[devId] = tab;
  localStorage.setItem("wbm_cf_card_hist_tabs", JSON.stringify(state.cardHistoryTabs));
  renderAutomationBotTab();
}

function renderCardIndividualHistoryHTML(dev) {
  const devId = dev.device_id;
  const activeTab = state.cardHistoryTabs[devId] || "commands";

  if (activeTab === "topics") {
    const feedItems = state.recentFeed.filter(f =>
      f.device_id === devId || (dev.master_id && f.device_id === dev.master_id)
    );
    if (feedItems.length === 0) {
      return `<div class="text-zinc-500 py-2">Nenhum pacote MQTT registrado ainda nos tópicos devices/${escapeHtml(devId)}/...</div>`;
    }
    return feedItems.slice(0, 25).map(f => {
      let badgeClass = "bg-zinc-800 text-zinc-300";
      let topicColor = "text-zinc-300";
      if (f.msg_type === "telemetry") {
        badgeClass = "bg-[#2ce610]/20 text-[#2ce610]";
        topicColor = "text-[#2ce610]";
      } else if (f.msg_type === "status") {
        badgeClass = "bg-amber-500/20 text-amber-300";
        topicColor = "text-amber-300";
      } else if (String(f.msg_type || "").includes("cmd")) {
        badgeClass = "bg-sky-500/20 text-sky-300";
        topicColor = "text-sky-400";
      }
      return `
        <div class="border-b border-wbm-border/40 pb-1 flex flex-wrap items-baseline gap-1.5">
          <span class="text-zinc-500">[${escapeHtml(formatTimeShort(f.created_at))}]</span>
          <span class="px-1.5 py-0.2 rounded text-[9px] font-bold uppercase ${badgeClass}">${escapeHtml(f.msg_type || "mqtt")}</span>
          <span class="${topicColor} font-bold">${escapeHtml(f.topic)}</span>
          <span class="text-zinc-200 break-all">→ ${escapeHtml(f.payload)}</span>
        </div>
      `;
    }).join("");
  }

  // Aba 'commands': combina os comandos auditados (ACK 1/2/3) e logs de ciclo/comando deste dispositivo
  const devCmds = state.recentCommands.filter(c => c.device_id === devId);
  const devLogs = state.botLogs.filter(l => l.device_id === devId || (l.message && l.message.includes(devId)));

  if (devCmds.length === 0 && devLogs.length === 0) {
    return `<div class="text-zinc-500 py-2">Nenhum comando ou ciclo registrado para ${escapeHtml(devId)} ainda.</div>`;
  }

  const cmdHtml = devCmds.slice(0, 12).map(c => {
    const ack3Iso = c.ack3_at || c.pos_confirmed_at;
    let stBadge = `<span class="px-1.5 py-0.2 rounded text-[9px] font-bold bg-zinc-800 text-zinc-300">ENVIADO</span>`;
    if (c.status === "ack3_positioned" || c.status === "position_confirmed" || ack3Iso) {
      stBadge = `<span class="px-1.5 py-0.2 rounded text-[9px] font-bold bg-[#2ce610]/20 text-[#2ce610]">✓ ACK 3 (POS: ${c.final_po ?? c.sm}%)</span>`;
    } else if (c.status === "ack2_valve" || c.ack2_at) {
      stBadge = `<span class="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300">ACK 2 (VÁLVULA)</span>`;
    } else if (c.status === "ack1_master" || c.ack1_at) {
      stBadge = `<span class="px-1.5 py-0.2 rounded text-[9px] font-bold bg-sky-500/20 text-sky-300">ACK 1 (MESTRE)</span>`;
    } else if (c.status === "timeout") {
      stBadge = `<span class="px-1.5 py-0.2 rounded text-[9px] font-bold bg-rose-500/20 text-rose-400">✕ TIMEOUT</span>`;
    }
    return `
      <div class="border-b border-wbm-border/40 pb-1 flex flex-wrap items-center justify-between gap-1.5">
        <div>
          <span class="text-zinc-500">[${escapeHtml(formatTimeShort(c.sent_at))}]</span>
          <span class="text-sky-400 font-bold">SM=${escapeHtml(c.sm)}${c.sm <= 100 ? "%" : ""}</span>
          <span class="text-zinc-400">(ED:${c.ed} MD:${c.md})</span>
          <span class="text-zinc-500">• ${escapeHtml(c.topic || `devices/${devId}/cmd`)}</span>
        </div>
        ${stBadge}
      </div>
    `;
  }).join("");

  const logHtml = devLogs.slice(0, 15).map(l => {
    let color = "text-zinc-300";
    if (l.message.includes("CONFIRMADO") || l.message.includes("concluído com sucesso")) color = "text-[#2ce610] font-bold";
    else if (l.message.includes("ALERTA") || l.message.includes("Erro") || l.message.includes("sem confirmação")) color = "text-rose-400 font-bold";
    else if (l.message.includes("Envio") || l.message.includes("Reenvio")) color = "text-sky-300";
    return `
      <div class="border-b border-wbm-border/30 pb-1">
        <span class="text-zinc-500">[${escapeHtml(l.time || formatTimeShort(l.created_at))}]</span>
        <span class="${color}">${escapeHtml(l.message)}</span>
      </div>
    `;
  }).join("");

  return cmdHtml + logHtml;
}

function setGlobalHistorySubTab(subTab) {
  state.globalHistorySubTab = subTab;
  localStorage.setItem("wbm_cf_global_hist_tab", subTab);
  renderGlobalHistoryPanel();
}

function setGlobalHistoryDeviceFilter(devId) {
  state.globalHistoryDeviceFilter = devId || "ALL";
  localStorage.setItem("wbm_cf_global_hist_dev_filter", state.globalHistoryDeviceFilter);
  renderGlobalHistoryPanel();
}

function renderGlobalHistoryPanel() {
  const subTab = state.globalHistorySubTab || "logs";
  const devFilter = state.globalHistoryDeviceFilter || "ALL";

  // Popula o filtro dropdown de dispositivos no Histórico Geral
  const filterSelect = document.getElementById("global-history-dev-filter");
  if (filterSelect) {
    const currentOpts = [
      `<option value="ALL" ${devFilter === "ALL" ? "selected" : ""}>Todos os Dispositivos (Geral)</option>`,
      ...state.devices.map(d =>
        `<option value="${escapeHtml(d.device_id)}" ${devFilter === d.device_id ? "selected" : ""}>Somente: ${escapeHtml(d.name)} (${escapeHtml(d.device_id)})</option>`
      )
    ].join("");
    if (filterSelect.innerHTML !== currentOpts) {
      filterSelect.innerHTML = currentOpts;
    }
  }

  // Botões das 3 sub-abas do Histórico Geral
  const btnLogs = document.getElementById("ghist-tab-logs");
  const btnTopics = document.getElementById("ghist-tab-topics");
  const btnAudit = document.getElementById("ghist-tab-audit");

  const boxLogs = document.getElementById("bot-global-log-box");
  const boxTopics = document.getElementById("bot-global-topics-box");
  const boxAudit = document.getElementById("bot-global-audit-box");

  if (btnLogs) {
    btnLogs.className = subTab === "logs"
      ? "flex-1 py-1.5 px-3 rounded-lg font-extrabold transition bg-[#2ce610] text-black"
      : "flex-1 py-1.5 px-3 rounded-lg font-extrabold transition text-zinc-400 hover:text-white";
  }
  if (btnTopics) {
    btnTopics.className = subTab === "topics"
      ? "flex-1 py-1.5 px-3 rounded-lg font-extrabold transition bg-amber-400 text-black"
      : "flex-1 py-1.5 px-3 rounded-lg font-extrabold transition text-zinc-400 hover:text-white";
  }
  if (btnAudit) {
    btnAudit.className = subTab === "audit"
      ? "flex-1 py-1.5 px-3 rounded-lg font-extrabold transition bg-sky-400 text-black"
      : "flex-1 py-1.5 px-3 rounded-lg font-extrabold transition text-zinc-400 hover:text-white";
  }

  boxLogs?.classList.toggle("hidden", subTab !== "logs");
  boxTopics?.classList.toggle("hidden", subTab !== "topics");
  boxAudit?.classList.toggle("hidden", subTab !== "audit");

  // Filtra listas conforme filtro selecionado (Geral ou Dispositivo específico)
  const filteredLogs = devFilter === "ALL"
    ? state.botLogs
    : state.botLogs.filter(l => l.device_id === devFilter || (l.message && l.message.includes(devFilter)));

  const filteredTopics = devFilter === "ALL"
    ? state.recentFeed
    : state.recentFeed.filter(f => f.device_id === devFilter || (f.topic && f.topic.includes(devFilter)));

  const filteredCmds = devFilter === "ALL"
    ? state.recentCommands
    : state.recentCommands.filter(c => c.device_id === devFilter);

  const logBadge = document.getElementById("bot-log-count-badge");
  if (logBadge) {
    if (subTab === "logs") logBadge.textContent = `${filteredLogs.length} logs`;
    else if (subTab === "topics") logBadge.textContent = `${filteredTopics.length} tópicos`;
    else logBadge.textContent = `${filteredCmds.length} comandos`;
  }

  // 1. Renderiza Log Geral de Comandos & Ciclos
  if (boxLogs) {
    if (filteredLogs.length === 0) {
      boxLogs.innerHTML = `<div class="text-zinc-500">Nenhum evento de comando ou ciclo registrado para o filtro atual.</div>`;
    } else {
      boxLogs.innerHTML = filteredLogs.map(l => {
        let color = "text-zinc-200";
        if (l.message.includes("CONFIRMADO") || l.message.includes("concluído com sucesso")) color = "text-[#2ce610] font-bold";
        else if (l.message.includes("ALERTA") || l.message.includes("Erro") || l.message.includes("sem confirmação")) color = "text-rose-400 font-bold";
        else if (l.message.includes("Envio") || l.message.includes("Reenvio")) color = "text-sky-300";
        else if (l.message.includes("Configurações salvas") || l.message.includes("Bot iniciado")) color = "text-amber-300";

        return `
          <div class="border-b border-wbm-border/40 pb-1">
            <span class="text-zinc-500">${escapeHtml(l.time || formatTimeShort(l.created_at))} -</span>
            <span class="${color}">${escapeHtml(l.message)}</span>
          </div>
        `;
      }).join("");
    }
  }

  // 2. Renderiza Feed Geral de Tópicos MQTT (/telemetry, /status, /cmd)
  if (boxTopics) {
    if (filteredTopics.length === 0) {
      boxTopics.innerHTML = `<div class="text-zinc-500">Aguardando tráfego MQTT nos tópicos devices/#...</div>`;
    } else {
      boxTopics.innerHTML = filteredTopics.map(f => {
        let color = "text-zinc-300";
        let badge = "bg-zinc-800 text-zinc-300";
        if (f.msg_type === "telemetry") {
          color = "text-[#2ce610]";
          badge = "bg-[#2ce610]/20 text-[#2ce610]";
        } else if (f.msg_type === "status") {
          color = "text-amber-300";
          badge = "bg-amber-500/20 text-amber-300";
        } else if (String(f.msg_type || "").includes("cmd")) {
          color = "text-sky-400";
          badge = "bg-sky-500/20 text-sky-300";
        }

        return `
          <div class="border-b border-wbm-border/40 pb-1.5 flex flex-wrap items-baseline gap-1.5">
            <span class="text-zinc-500">[${escapeHtml(formatDateTimeBR(f.created_at))}]</span>
            <span class="px-1.5 py-0.2 rounded text-[10px] font-bold uppercase ${badge}">${escapeHtml(f.msg_type || "mqtt")}</span>
            <span class="${color} font-bold">${escapeHtml(f.topic)}</span>
            <span class="text-zinc-200 break-all">→ ${escapeHtml(f.payload)}</span>
          </div>
        `;
      }).join("");
    }
  }

  // 3. Renderiza Tabela Geral de Comandos Auditados (Todos os Dispositivos)
  const auditTbody = document.getElementById("bot-global-audit-tbody");
  if (auditTbody) {
    if (filteredCmds.length === 0) {
      auditTbody.innerHTML = `
        <tr>
          <td colspan="5" class="py-6 text-center text-zinc-500">Nenhum comando registrado no histórico geral.</td>
        </tr>
      `;
    } else {
      auditTbody.innerHTML = filteredCmds.map(c => {
        const ack3Iso = c.ack3_at || c.pos_confirmed_at;
        let statusPill = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-zinc-800 text-zinc-300">Enviado</span>`;
        if (c.status === "ack3_positioned" || c.status === "position_confirmed" || ack3Iso) {
          statusPill = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#2ce610]/20 text-[#2ce610]">✓ ACK 3 (${c.final_po ?? c.sm}%)</span>`;
        } else if (c.status === "ack2_valve" || c.ack2_at) {
          statusPill = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300">ACK 2 (Válvula)</span>`;
        } else if (c.status === "ack1_master" || c.ack1_at) {
          statusPill = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/20 text-sky-300">ACK 1 (Mestre)</span>`;
        } else if (c.status === "timeout") {
          statusPill = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-400">✕ Sem Resp.</span>`;
        }

        const acksSummary = [
          c.ack1_at ? "1✓" : "1-",
          c.ack2_at ? "2✓" : "2-",
          ack3Iso ? "3✓" : "3-"
        ].join(" ");

        return `
          <tr class="hover:bg-wbm-surface/60 transition">
            <td class="py-2 px-2.5 font-mono text-zinc-300 whitespace-nowrap">${escapeHtml(formatDateTimeBR(c.sent_at))}</td>
            <td class="py-2 px-2.5 font-mono font-bold text-wbm-green">
              ${escapeHtml(c.device_id)}
              <span class="block text-[10px] text-zinc-400 font-normal">ED:${c.ed} • MD:${c.md}</span>
            </td>
            <td class="py-2 px-2.5 font-mono">
              <strong class="text-sky-300">SM ${escapeHtml(c.sm)}${c.sm <= 100 ? "%" : ""}</strong>
              <span class="block text-[10px] text-zinc-500">${escapeHtml(c.topic || `devices/${c.device_id}/cmd`)}</span>
            </td>
            <td class="py-2 px-2.5 font-mono text-[11px] text-zinc-300">${escapeHtml(acksSummary)}</td>
            <td class="py-2 px-2.5">${statusPill}</td>
          </tr>
        `;
      }).join("");
    }
  }
}

function setDeviceCardMode(devId, mode) {
  state.deviceCommandModes[devId] = mode;
  localStorage.setItem("wbm_cf_cmd_modes", JSON.stringify(state.deviceCommandModes));
  renderAutomationBotTab();
}

function setSingleTabCommandMode(mode) {
  state.singleTabCommandMode = mode;
  localStorage.setItem("wbm_cf_single_cmd_mode", mode);
  updateSingleTabCommandModeUI();
}

function updateSingleTabCommandModeUI() {
  const mode = state.singleTabCommandMode || "auto";
  const btnAuto = document.getElementById("single-mode-btn-auto");
  const btnManual = document.getElementById("single-mode-btn-manual");
  const panelAuto = document.getElementById("single-panel-auto");
  const panelManual = document.getElementById("single-panel-manual");

  if (btnAuto && btnManual) {
    btnAuto.className = mode === "auto"
      ? "px-5 py-2.5 rounded-xl font-extrabold text-xs transition flex items-center gap-2 bg-[#2ce610] text-black shadow-[0_0_16px_rgba(44,230,16,0.3)]"
      : "px-5 py-2.5 rounded-xl font-extrabold text-xs transition flex items-center gap-2 bg-wbm-black text-zinc-400 hover:text-white border border-wbm-border";
    btnManual.className = mode === "manual"
      ? "px-5 py-2.5 rounded-xl font-extrabold text-xs transition flex items-center gap-2 bg-sky-400 text-black shadow-[0_0_16px_rgba(56,189,248,0.3)]"
      : "px-5 py-2.5 rounded-xl font-extrabold text-xs transition flex items-center gap-2 bg-wbm-black text-zinc-400 hover:text-white border border-wbm-border";
  }

  if (panelAuto && panelManual) {
    if (mode === "auto") {
      panelAuto.classList.remove("hidden");
      panelManual.classList.add("hidden");
    } else {
      panelAuto.classList.add("hidden");
      panelManual.classList.remove("hidden");
    }
  }
}

async function sendManualBotCardCommand(devId, safeId, quickSm = null) {
  try {
    const edInput = document.getElementById(`mcard-ed-${safeId}`);
    const mdInput = document.getElementById(`mcard-md-${safeId}`);
    const smInput = document.getElementById(`mcard-sm-${safeId}`);

    const ed = Number(edInput?.value ?? 1);
    const md = Number(mdInput?.value ?? 2);
    if (quickSm !== null && smInput) {
      smInput.value = quickSm;
    }
    const sm = Number(quickSm !== null ? quickSm : (smInput?.value ?? 100));

    if (Number.isNaN(sm) || sm < 0 || sm > 1000) {
      showToast("Digite um valor válido para o comando SM (0 a 100% ou código especial).");
      return;
    }

    // Atualiza também no estado local para que o novo ED e MD fiquem fixos imediatamente
    const devObj = state.devices.find(d => d.device_id === devId);
    if (devObj) {
      devObj.ed = ed;
      devObj.md = md;
    }
    const autoEd = document.getElementById(`bcard-ed-${safeId}`);
    const autoMd = document.getElementById(`bcard-md-${safeId}`);
    if (autoEd) autoEd.value = ed;
    if (autoMd) autoMd.value = md;

    await apiPost("/api/command", {
      device_id: devId,
      ed,
      md,
      sm,
      origin: "Envio Manual Direto (Card do Dispositivo)"
    });
    showToast(`🚀 [${devId}] Comando manual SM=${sm}${sm <= 100 ? "%" : ""} (ED:${ed}, MD:${md}) enviado imediatamente!`);
    await pollServerState();
  } catch (err) {
    showToast(`Erro ao enviar comando manual: ${err.message}`);
  }
}

function readBotCardInputs(devId, safeId) {
  const existing = state.devices.find(d => d.device_id === devId) || { device_id: devId };
  const vMin = Number(document.getElementById(`bcard-min-${safeId}`)?.value ?? 1);
  const vMax = Number(document.getElementById(`bcard-max-${safeId}`)?.value ?? 100);
  if (vMin < 0 || vMin > 100 || vMax < 0 || vMax > 100) {
    throw new Error("Os limites mínimo e máximo devem estar entre 0 e 100%.");
  }
  const intervalo = Number(String(document.getElementById(`bcard-int-${safeId}`)?.value ?? 10).replace(",", "."));
  const espera = Number(String(document.getElementById(`bcard-ver-${safeId}`)?.value ?? 2).replace(",", "."));
  const tentativas = Number(document.getElementById(`bcard-tent-${safeId}`)?.value ?? 3);
  if (intervalo <= 0 || espera <= 0 || tentativas < 1) {
    throw new Error("Os tempos e o número de envios devem ser maiores que zero.");
  }

  return {
    ...existing,
    device_id: devId,
    ed: Number(document.getElementById(`bcard-ed-${safeId}`)?.value ?? 1),
    md: Number(document.getElementById(`bcard-md-${safeId}`)?.value ?? 2),
    test_min: vMin,
    test_max: vMax,
    test_start_by: document.getElementById(`bcard-start-${safeId}`)?.value || "max",
    test_interval_min: intervalo,
    test_timeout_min: espera,
    test_max_retries: tentativas
  };
}

async function saveManualBotCardDevice(devId, safeId, silent = false) {
  try {
    const existing = state.devices.find(d => d.device_id === devId) || { device_id: devId };
    const ed = Number(document.getElementById(`mcard-ed-${safeId}`)?.value ?? existing.ed ?? 1);
    const md = Number(document.getElementById(`mcard-md-${safeId}`)?.value ?? existing.md ?? 2);

    // Sincroniza também os inputs do modo automático no mesmo card
    const autoEd = document.getElementById(`bcard-ed-${safeId}`);
    const autoMd = document.getElementById(`bcard-md-${safeId}`);
    if (autoEd) autoEd.value = ed;
    if (autoMd) autoMd.value = md;

    const payload = {
      ...existing,
      device_id: devId,
      ed,
      md
    };
    if (existing) {
      existing.ed = ed;
      existing.md = md;
    }
    await apiPost("/api/devices", payload);
    if (!silent) {
      showToast(`💾 [${devId}] Configuração Manual salva em config.json (ED: ${ed} | Modo: ${md})!`);
      await pollServerState();
    }
  } catch (err) {
    if (!silent) showToast(`Erro ao salvar configuração: ${err.message}`);
  }
}

const __autoSaveTimers = {};

function saveManualSmValue(devId, val) {
  if (!devId) return;
  state.manualSmValues[devId] = val;
  localStorage.setItem("wbm_cf_manual_sm_values", JSON.stringify(state.manualSmValues));
}

function scheduleAutoSaveBotCardInput(devId, safeId) {
  clearTimeout(__autoSaveTimers[`bcard_${safeId}`]);
  __autoSaveTimers[`bcard_${safeId}`] = setTimeout(() => {
    autoSaveBotCardInput(devId, safeId);
  }, 400);
}

function scheduleAutoSaveManualCard(devId, safeId) {
  clearTimeout(__autoSaveTimers[`mcard_${safeId}`]);
  __autoSaveTimers[`mcard_${safeId}`] = setTimeout(() => {
    saveManualBotCardDevice(devId, safeId, true);
  }, 400);
}

function scheduleSaveTestConfigOnly() {
  clearTimeout(__autoSaveTimers["single_test"]);
  __autoSaveTimers["single_test"] = setTimeout(() => {
    saveTestConfigOnly(true);
  }, 400);
}

function saveReportPref(key, value) {
  state.reportPrefs[key] = value;
  localStorage.setItem("wbm_cf_report_prefs", JSON.stringify(state.reportPrefs));
}

async function autoSaveBotCardInput(devId, safeId) {
  try {
    const payload = readBotCardInputs(devId, safeId);
    const manEd = document.getElementById(`mcard-ed-${safeId}`);
    const manMd = document.getElementById(`mcard-md-${safeId}`);
    if (manEd) manEd.value = payload.ed;
    if (manMd) manMd.value = payload.md;
    const devObj = state.devices.find(d => d.device_id === devId);
    if (devObj) {
      Object.assign(devObj, payload);
    }
    await apiPost("/api/devices", payload);
  } catch (err) {
    console.warn("Erro ao auto-salvar parâmetro do card:", err);
  }
}

async function saveBotCardDevice(devId, safeId) {
  try {
    const payload = readBotCardInputs(devId, safeId);
    const devObj = state.devices.find(d => d.device_id === devId);
    if (devObj) Object.assign(devObj, payload);
    await apiPost("/api/devices", payload);
    showToast(`[${devId} | ED ${payload.ed}] Configurações salvas em config.json! Limites: ${payload.test_min}% a ${payload.test_max}% (Iniciando por: ${payload.test_start_by === "max" ? "Máximo" : "Mínimo"}).`);
    await pollServerState();
  } catch (err) {
    showToast(`Erro: ${err.message}`);
  }
}

async function startBotCardDevice(devId, safeId) {
  try {
    const payload = readBotCardInputs(devId, safeId);
    const devObj = state.devices.find(d => d.device_id === devId);
    if (devObj) Object.assign(devObj, payload);
    await apiPost("/api/test/start", {
      device_id: devId,
      params: payload
    });
    showToast(`Automação cíclica iniciada para ${devId} (${payload.test_min}% ↔ ${payload.test_max}% • Iniciando por ${payload.test_start_by === "max" ? "Máximo" : "Mínimo"})!`);
    await pollServerState();
  } catch (err) {
    showToast(`Erro ao iniciar: ${err.message}`);
  }
}

async function stopBotCardDevice(devId, safeId = null) {
  try {
    const resolvedSafeId = safeId || devId.replace(/[^a-zA-Z0-9_-]/g, "_");
    let params = null;
    try {
      params = readBotCardInputs(devId, resolvedSafeId);
      const devObj = state.devices.find(d => d.device_id === devId);
      if (devObj) Object.assign(devObj, params);
    } catch (_) {}
    await apiPost("/api/test/stop", { device_id: devId, params });
    showToast(`Automação parada para ${devId}.`);
    await pollServerState();
  } catch (err) {
    showToast(`Erro ao parar: ${err.message}`);
  }
}

async function removeBotDeviceCard(devId) {
  if (!confirm(`Remover definitivamente o dispositivo '${devId}' do Bot e do config.json?`)) return;
  try {
    await apiPost("/api/devices/delete", { device_id: devId });
    showToast(`Dispositivo '${devId}' removido com sucesso.`);
    await pollServerState();
  } catch (err) {
    showToast(`Erro ao remover: ${err.message}`);
  }
}

async function startAllBotTestsUI() {
  try {
    const res = await apiPost("/api/test/start_all", {});
    showToast(`Testes cíclicos iniciados simultaneamente para ${res.started?.length || 0} válvula(s)!`);
    await pollServerState();
  } catch (err) {
    showToast(`Erro ao iniciar todas: ${err.message}`);
  }
}

async function stopAllBotTestsUI() {
  try {
    await apiPost("/api/test/stop_all", {});
    showToast("Todos os testes automatizados foram interrompidos.");
    await pollServerState();
  } catch (err) {
    showToast(`Erro ao parar testes: ${err.message}`);
  }
}

async function saveBotConnectionAndJsonUI() {
  try {
    const textarea = document.getElementById("bot-config-json-textarea");
    let parsed = {};
    if (textarea && textarea.value.trim()) {
      parsed = JSON.parse(textarea.value);
    }
    parsed.broker = document.getElementById("bot-cfg-broker").value.trim() || "163.176.56.133";
    parsed.porta = Number(document.getElementById("bot-cfg-porta").value || 1883);
    parsed.username = document.getElementById("bot-cfg-user").value.trim() || "wbm_technology";
    parsed.password = document.getElementById("bot-cfg-pass").value || "Wbm.technology01";
    parsed.reconnect_mqtt = true;

    await apiPost("/api/config_json", parsed);
    state.editingConfigJson = false;
    showToast("Arquivo config.json salvo e conexão MQTT atualizada!");
    setTimeout(pollServerState, 1200);
  } catch (err) {
    showToast(`Erro ao salvar config.json: ${err.message}`);
  }
}

function downloadConfigJsonFile() {
  const content = JSON.stringify(state.configJson || {}, null, 4);
  const blob = new Blob([content], { type: "application/json;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "config.json";
  a.click();
  URL.revokeObjectURL(url);
  showToast("Arquivo config.json baixado!");
}

async function refreshSelectedDeviceDetail(populateInputs = false) {
  if (!state.selectedDeviceId) return;
  try {
    const detail = await apiGet(`/api/device/detail?device_id=${encodeURIComponent(state.selectedDeviceId)}&limit=350`);
    state.currentDetail = detail;
    renderCurrentDeviceHeaderAndKPIs(detail, populateInputs);
    renderHandshakePipeline(detail);
    updateAllCharts(detail);
    renderCommandsAuditTable(detail);
    renderErrorsHistoryTable(detail);
    renderDeviceMqttFeed(state.selectedDeviceId, detail);
    renderDeviceIndividualBotLogs(state.selectedDeviceId, detail);
    if (state.activeView === "automation") {
      renderAutomationBotTab();
    }

    if (populateInputs || !state.reportDirty) {
      regenerateTechnicalReport();
    }
  } catch (err) {
    console.warn("Erro ao carregar detalhes do dispositivo:", err);
  }
}

// ============================================================================
// Renderização de KPIs, Cabeçalho e Pipeline de Handshake (Status 1, 2, 3)
// ============================================================================
function renderCurrentDeviceHeaderAndKPIs(detail, populateInputs) {
  const cfg = detail.config || {};
  const lv = detail.live || {};
  const cmds = detail.commands_audit || [];
  const tel = detail.telemetry_history || [];

  const devId = cfg.device_id || state.selectedDeviceId;
  const devType = cfg.type || "CF";
  const ed = lv.ed ?? cfg.ed ?? 1;
  const md = lv.md ?? cfg.md ?? 2;
  const mdText = md === 1 ? "1 (Automático)" : "2 (Manual)";

  document.getElementById("dev-badge-type").textContent =
    devType === "MP" ? "PRESSURE MONITOR (MP)" : devType === "ML" ? "LEVEL MONITOR (ML)" : "CONTROL FLOW (CF)";
  document.getElementById("dev-badge-id").textContent = devId;
  document.getElementById("dev-badge-node").textContent = `Node (ed): ${ed} • Modo (md): ${mdText}`;
  document.getElementById("dev-title").textContent = `${cfg.name || devId} — ${cfg.client || "WBM"}`;
  document.getElementById("dev-topics-summary").textContent =
    `devices/${devId}/telemetry | devices/${devId}/status | devices/${devId}/cmd`;

  const er = Number(lv.er || 0);
  const age = formatAge(lv.last_seen);
  const statusBadge = document.getElementById("dev-badge-status");
  if (er !== 0) {
    statusBadge.className = "px-2.5 py-0.5 text-xs font-bold rounded-full bg-rose-500/20 text-rose-400";
    statusBadge.textContent = `● ${CF_ERRORS[er] || `Erro ${er}`}`;
  } else if (age.mins > 300) {
    statusBadge.className = "px-2.5 py-0.5 text-xs font-bold rounded-full bg-amber-500/20 text-amber-300";
    statusBadge.textContent = `● Sem telemetria recente (${age.text})`;
  } else {
    statusBadge.className = "px-2.5 py-0.5 text-xs font-bold rounded-full bg-emerald-500/20 text-emerald-400";
    statusBadge.textContent = "● Operando Normalmente";
  }

  // KPIs
  const lastCmd = cmds.find(c => c.sm >= 0 && c.sm <= 100) || cmds[0] || null;
  const po = lv.po !== null && lv.po !== undefined ? Number(lv.po) : (tel.length ? Number(tel[tel.length - 1].po) : null);
  const sm = lv.sm !== null && lv.sm !== undefined ? Number(lv.sm) : (lastCmd ? Number(lastCmd.sm) : null);

  if (devType === "MP") {
    document.getElementById("kpi-po").textContent = lv.pressao !== null && lv.pressao !== undefined ? `${Number(lv.pressao).toFixed(2)} bar` : "---";
    document.getElementById("kpi-po-sub").textContent = lv.temp !== null && lv.temp !== undefined ? `Temp: ${Number(lv.temp).toFixed(1)} °C` : "Estabilização 30s";
  } else {
    document.getElementById("kpi-po").textContent = po !== null && !Number.isNaN(po) ? `${po}%` : "---%";
    document.getElementById("kpi-po-sub").textContent = `Modo ${md === 1 ? "Automático" : "Manual"}`;
  }

  document.getElementById("kpi-sm").textContent = sm !== null && !Number.isNaN(sm) ? `${sm}%` : "---%";
  document.getElementById("kpi-sm-sub").textContent = lastCmd ? `Enviado às ${formatTimeShort(lastCmd.sent_at)}` : "Sem comando";

  const kpiConfirm = document.getElementById("kpi-confirm");
  const kpiConfirmSub = document.getElementById("kpi-confirm-sub");
  const verifyState = lv.pos_verify_state || "idle";
  if (sm === null || po === null) {
    kpiConfirm.textContent = "Aguardando";
    kpiConfirm.className = "text-sm font-extrabold text-zinc-400 mt-1.5";
    kpiConfirmSub.textContent = "Aguardando leitura po/sm";
  } else if (verifyState === "divergent") {
    kpiConfirm.textContent = `⚠ DIVERGENTE (${po}% ≠ ${sm}%)`;
    kpiConfirm.className = "text-sm font-extrabold text-rose-400 mt-1.5";
    kpiConfirmSub.textContent = `Sem confirmação após tentativas`;
  } else if (isPositionConfirmed(sm, po) || verifyState === "confirmed") {
    kpiConfirm.textContent = `✓ CONFIRMADO (${po}%)`;
    kpiConfirm.className = "text-sm font-extrabold text-[#2ce610] mt-1.5";
    kpiConfirmSub.textContent = `Posição == Alvo (${sm}%)`;
  } else if (verifyState === "waiting" || lv.test_running) {
    kpiConfirm.textContent = `⏳ AGUARDANDO (${po}% → ${sm}%)`;
    kpiConfirm.className = "text-sm font-extrabold text-amber-300 mt-1.5";
    kpiConfirmSub.textContent = `Em movimento / Aguardando resp.`;
  } else {
    kpiConfirm.textContent = `✓ POSICIONADO (${po}%)`;
    kpiConfirm.className = "text-sm font-extrabold text-[#2ce610] mt-1.5";
    kpiConfirmSub.textContent = `Leitura sincronizada`;
  }

  // Corrente do motor
  const curMa = Number(lv.corrente || 0);
  const peakMa = Math.max(Number(lv.pico_corrente || 0), ...tel.map(t => Number(t.pico_corrente || t.corrente || 0)));
  document.getElementById("kpi-current").textContent = `${Math.round(curMa)} mA`;
  document.getElementById("kpi-current-sub").textContent = `Pico máx: ${Math.round(peakMa > 0 ? peakMa : 0)} mA`;
  document.getElementById("current-source-badge").textContent = `Fonte: ${lv.current_source || "Analítico / MQTT"}`;

  // Ciclos / Voltas
  document.getElementById("kpi-cycles").textContent = `${lv.qc ?? "---"} / ${lv.qv ?? "---"}`;
  document.getElementById("kpi-cycles-sub").textContent = "Ciclos (qc) / Voltas (qv)";

  // Erro
  const kpiErr = document.getElementById("kpi-error");
  if (er === 0) {
    kpiErr.textContent = "0 (Sem Erro)";
    kpiErr.className = "text-base font-extrabold text-[#2ce610] mt-1.5";
  } else {
    kpiErr.textContent = `ERRO ${er}`;
    kpiErr.className = "text-base font-extrabold text-rose-500 mt-1.5";
  }
  document.getElementById("kpi-error-sub").textContent = CF_ERRORS[er] || `Código ${er}`;

  // Taxa de sucesso dos comandos de setpoint
  const posCmds = cmds.filter(c => c.sm >= 0 && c.sm <= 100);
  const okCmds = posCmds.filter(c => c.ack3_at || c.pos_confirmed_at || c.status === "ack3_positioned" || c.status === "position_confirmed");
  const rate = posCmds.length > 0 ? Math.round((okCmds.length / posCmds.length) * 100) : 100;
  document.getElementById("kpi-success-rate").textContent = `${rate}%`;
  document.getElementById("kpi-success-sub").textContent = `${okCmds.length} / ${posCmds.length} confirmados`;

  document.getElementById("kpi-last-seen").textContent = age.text;
  document.getElementById("kpi-last-ack").textContent = `Último Status ACK: ${lv.last_status_ack || "---"}`;

  // Atualiza status do executor de testes automatizados
  const runnerBadge = document.getElementById("test-runner-badge");
  if (lv.test_running) {
    runnerBadge.className = "px-3 py-1 text-xs font-extrabold rounded-full bg-[#2ce610]/20 text-[#2ce610] animate-pulse";
    runnerBadge.textContent = "● EXECUTANDO TESTES";
  } else {
    runnerBadge.className = "px-3 py-1 text-xs font-extrabold rounded-full bg-zinc-800 text-zinc-400";
    runnerBadge.textContent = "● Parado";
  }
  document.getElementById("test-phase-text").textContent = lv.test_phase || "Parado";
  document.getElementById("test-stat-done").textContent = lv.test_cycles_done || 0;
  document.getElementById("test-stat-ok").textContent = lv.test_cycles_ok || 0;
  document.getElementById("test-stat-fail").textContent = lv.test_cycles_fail || 0;

  if (populateInputs) {
    const edVal = cfg.ed ?? 1;
    const mdVal = cfg.md ?? 2;
    if (document.getElementById("cmd-ed")) document.getElementById("cmd-ed").value = edVal;
    if (document.getElementById("cmd-md")) document.getElementById("cmd-md").value = mdVal;
    if (document.getElementById("cmd-sm") && state.manualSmValues[devId] !== undefined) {
      document.getElementById("cmd-sm").value = state.manualSmValues[devId];
    }
    if (document.getElementById("cmd-use-master-topic")) {
      document.getElementById("cmd-use-master-topic").checked = Boolean(state.useMasterTopic);
    }
    if (document.getElementById("device-topic-type-filter")) {
      document.getElementById("device-topic-type-filter").value = state.deviceTopicTypeFilter || "ALL";
    }
    if (document.getElementById("auto-ed")) document.getElementById("auto-ed").value = edVal;
    if (document.getElementById("auto-md")) document.getElementById("auto-md").value = mdVal;
    document.getElementById("test-min").value = cfg.test_min ?? 1;
    document.getElementById("test-max").value = cfg.test_max ?? 100;
    document.getElementById("test-start-by").value = cfg.test_start_by || "max";
    document.getElementById("test-interval").value = cfg.test_interval_min ?? 10;
    document.getElementById("test-timeout").value = cfg.test_timeout_min ?? 2;
    document.getElementById("test-retries").value = cfg.test_max_retries ?? 3;
  }
}

function renderHandshakePipeline(detail) {
  const cmds = detail.commands_audit || [];
  const last = cmds[0];
  const summaryEl = document.getElementById("handshake-cmd-summary");

  const setCardStyle = (idx, active, timeText) => {
    const card = document.getElementById(`hs-step-${idx}`);
    const tEl = document.getElementById(`hs-step-${idx}-time`);
    if (!card || !tEl) return;
    tEl.textContent = timeText;
    if (active) {
      card.className = "p-3 rounded-xl border border-[#2ce610] bg-[#2ce610]/10 flex items-center gap-3";
    } else {
      card.className = "p-3 rounded-xl border border-wbm-border bg-wbm-surface flex items-center gap-3 opacity-60";
    }
  };

  if (!last) {
    summaryEl.textContent = "Nenhum comando enviado ainda para este dispositivo";
    setCardStyle(0, false, "Aguardando envio");
    setCardStyle(1, false, "Aguardando Status '1'");
    setCardStyle(2, false, "Aguardando Status '2'");
    setCardStyle(3, false, "Aguardando Status '3'");
    return;
  }

  summaryEl.textContent = `Último comando: SM=${last.sm} (ED=${last.ed}, MD=${last.md}) • Enviado em ${formatDateTimeBR(last.sent_at)}`;

  setCardStyle(0, true, `Enviado às ${formatTimeShort(last.sent_at)} (${last.origin || "MQTT"})`);

  const d1 = diffSeconds(last.sent_at, last.ack1_at);
  setCardStyle(
    1,
    Boolean(last.ack1_at),
    last.ack1_at ? `Confirmado às ${formatTimeShort(last.ack1_at)} (+${d1 ?? 0}s)` : "Pendente de Status '1'"
  );

  const d2 = diffSeconds(last.sent_at, last.ack2_at);
  setCardStyle(
    2,
    Boolean(last.ack2_at),
    last.ack2_at ? `Na Válvula às ${formatTimeShort(last.ack2_at)} (+${d2 ?? 0}s)` : "Pendente de Status '2'"
  );

  const ack3Iso = last.ack3_at || last.pos_confirmed_at;
  const d3 = diffSeconds(last.sent_at, ack3Iso);
  setCardStyle(
    3,
    Boolean(ack3Iso),
    ack3Iso
      ? `Posicionado (${last.final_po ?? last.sm}%) às ${formatTimeShort(ack3Iso)} (+${d3 ?? 0}s)`
      : "Aguardando atingir posição física"
  );
}

// ============================================================================
// Gráficos Históricos (Chart.js)
// ============================================================================
function updateAllCharts(detail) {
  const tel = detail.telemetry_history || [];
  const cmds = (detail.commands_audit || []).slice().reverse();
  const cfg = detail.config || {};

  const labels = tel.map(r => formatTimeShort(r.created_at));
  const poData = tel.map(r => r.po !== null && r.po !== undefined ? Number(r.po) : null);

  // Reconstrói a linha de Setpoint ativo (sm) para cada ponto de telemetria
  let activeSm = null;
  const smData = tel.map(r => {
    if (r.sm !== null && r.sm !== undefined) {
      activeSm = Number(r.sm);
    } else {
      const tMs = new Date(r.created_at).getTime();
      for (const c of cmds) {
        if (c.sm >= 0 && c.sm <= 100 && new Date(c.sent_at).getTime() <= tMs) {
          activeSm = Number(c.sm);
        }
      }
    }
    return activeSm;
  });

  // 1. Gráfico Setpoints (sm) vs Posição Real (po)
  const ctx1 = document.getElementById("chart-setpoint-pos");
  if (ctx1) {
    if (!state.charts.setpointPos) {
      state.charts.setpointPos = new Chart(ctx1, {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              label: "Setpoint Enviado (sm %)",
              data: smData,
              borderColor: "#38bdf8",
              backgroundColor: "rgba(56, 189, 248, 0.08)",
              borderWidth: 2,
              borderDash: [6, 4],
              stepped: true,
              pointRadius: 2,
              tension: 0
            },
            {
              label: "Posição Confirmada Válvula (po %)",
              data: poData,
              borderColor: "#2ce610",
              backgroundColor: "rgba(44, 230, 16, 0.14)",
              borderWidth: 2.5,
              fill: true,
              pointRadius: 3,
              tension: 0.2
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { labels: { color: "#d4d4d8", font: { size: 11 } } }
          },
          scales: {
            x: { ticks: { color: "#71717a", maxTicksLimit: 10 }, grid: { color: "#181c20" } },
            y: {
              min: 0,
              max: 105,
              ticks: { color: "#a1a1aa", callback: v => `${v}%` },
              grid: { color: "#1f2428" }
            }
          }
        }
      });
    } else {
      state.charts.setpointPos.data.labels = labels;
      state.charts.setpointPos.data.datasets[0].data = smData;
      state.charts.setpointPos.data.datasets[1].data = poData;
      state.charts.setpointPos.update("none");
    }
  }

  // 2. Gráfico Corrente do Motor (mA)
  const currData = tel.map(r => Number(r.corrente || 0));
  const avgCurrData = tel.map(r => Number(r.media_corrente || cfg.nominal_current_ma || 4000));
  const stallCurrData = tel.map(r => Number(r.corrente_trava || cfg.stall_current_ma || 7000));

  const ctx2 = document.getElementById("chart-motor-current");
  if (ctx2) {
    if (!state.charts.motorCurrent) {
      state.charts.motorCurrent = new Chart(ctx2, {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              label: "Corrente do Motor (mA)",
              data: currData,
              borderColor: "#fbbf24",
              backgroundColor: "rgba(251, 191, 36, 0.15)",
              borderWidth: 2.5,
              fill: true,
              pointRadius: 2.5,
              tension: 0.25
            },
            {
              label: "Média Nominal Livre (mA)",
              data: avgCurrData,
              borderColor: "#38bdf8",
              borderWidth: 1.5,
              borderDash: [4, 4],
              pointRadius: 0
            },
            {
              label: "Limite Corrente Trava / Erro 3 (mA)",
              data: stallCurrData,
              borderColor: "#f43f5e",
              borderWidth: 1.8,
              borderDash: [6, 3],
              pointRadius: 0
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { labels: { color: "#d4d4d8", font: { size: 11 } } }
          },
          scales: {
            x: { ticks: { color: "#71717a", maxTicksLimit: 10 }, grid: { color: "#181c20" } },
            y: {
              min: 0,
              ticks: { color: "#a1a1aa", callback: v => `${v} mA` },
              grid: { color: "#1f2428" }
            }
          }
        }
      });
    } else {
      state.charts.motorCurrent.data.labels = labels;
      state.charts.motorCurrent.data.datasets[0].data = currData;
      state.charts.motorCurrent.data.datasets[1].data = avgCurrData;
      state.charts.motorCurrent.data.datasets[2].data = stallCurrData;
      state.charts.motorCurrent.update("none");
    }
  }

  // 3. Gráfico Histórico de Códigos de Erro (0 a 7)
  const errData = tel.map(r => Number(r.er || 0));
  const ctx3 = document.getElementById("chart-errors-timeline");
  if (ctx3) {
    if (!state.charts.errorsTimeline) {
      state.charts.errorsTimeline = new Chart(ctx3, {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              label: "Código de Erro (er: 0=OK, 1=Motor, 3=Travou, 4=Sensor, 6=Eixo, 7=Timeout LoRa)",
              data: errData,
              borderColor: "#f43f5e",
              backgroundColor: "rgba(244, 63, 94, 0.2)",
              borderWidth: 2.2,
              stepped: true,
              fill: true,
              pointRadius: 3
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: "#d4d4d8", font: { size: 11 } } }
          },
          scales: {
            x: { ticks: { color: "#71717a", maxTicksLimit: 10 }, grid: { color: "#181c20" } },
            y: {
              min: 0,
              max: 8,
              ticks: { stepSize: 1, color: "#fda4af" },
              grid: { color: "#1f2428" }
            }
          }
        }
      });
    } else {
      state.charts.errorsTimeline.data.labels = labels;
      state.charts.errorsTimeline.data.datasets[0].data = errData;
      state.charts.errorsTimeline.update("none");
    }
  }

  // 4. Gráfico Latência do Handshake (ACK 1, ACK 2, ACK 3) por Comando de Teste
  const recentCmds = cmds.slice(-15);
  const cmdLabels = recentCmds.map(c => `${formatTimeShort(c.sent_at)} (${c.sm}%)`);
  const ack1Lat = recentCmds.map(c => diffSeconds(c.sent_at, c.ack1_at) ?? 0);
  const ack2Lat = recentCmds.map(c => diffSeconds(c.sent_at, c.ack2_at) ?? 0);
  const ack3Lat = recentCmds.map(c => diffSeconds(c.sent_at, c.ack3_at || c.pos_confirmed_at) ?? 0);

  const ctx4 = document.getElementById("chart-latency-cycles");
  if (ctx4) {
    if (!state.charts.latencyCycles) {
      state.charts.latencyCycles = new Chart(ctx4, {
        type: "bar",
        data: {
          labels: cmdLabels,
          datasets: [
            {
              label: "ACK 1 • Mestre Recebeu (s)",
              data: ack1Lat,
              backgroundColor: "#38bdf8"
            },
            {
              label: "ACK 2 • Válvula Recebeu LoRa (s)",
              data: ack2Lat,
              backgroundColor: "#fbbf24"
            },
            {
              label: "ACK 3 • Posição Física Confirmada (s)",
              data: ack3Lat,
              backgroundColor: "#2ce610"
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: "#d4d4d8", font: { size: 11 } } }
          },
          scales: {
            x: { ticks: { color: "#71717a" }, grid: { color: "#181c20" } },
            y: {
              beginAtZero: true,
              ticks: { color: "#a1a1aa", callback: v => `${v}s` },
              grid: { color: "#1f2428" }
            }
          }
        }
      });
    } else {
      state.charts.latencyCycles.data.labels = cmdLabels;
      state.charts.latencyCycles.data.datasets[0].data = ack1Lat;
      state.charts.latencyCycles.data.datasets[1].data = ack2Lat;
      state.charts.latencyCycles.data.datasets[2].data = ack3Lat;
      state.charts.latencyCycles.update("none");
    }
  }
}

// ============================================================================
// Tabelas de Auditoria de Comandos e Histórico de Erros
// ============================================================================
function renderCommandsAuditTable(detail) {
  const cmds = detail.commands_audit || [];
  const tbody = document.getElementById("commands-audit-tbody");
  const badge = document.getElementById("commands-count-badge");
  if (badge) badge.textContent = `${cmds.length} comandos registrados`;
  if (!tbody) return;

  if (cmds.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="py-6 text-center text-zinc-500">
          Nenhum comando enviado ou capturado para este equipamento ainda.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = cmds.map(c => {
    const d1 = diffSeconds(c.sent_at, c.ack1_at);
    const d2 = diffSeconds(c.sent_at, c.ack2_at);
    const ack3Iso = c.ack3_at || c.pos_confirmed_at;
    const d3 = diffSeconds(c.sent_at, ack3Iso);

    let statusPill = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-zinc-800 text-zinc-300">Enviado</span>`;
    if (c.status === "ack3_positioned" || c.status === "position_confirmed" || ack3Iso) {
      statusPill = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#2ce610]/20 text-[#2ce610]">✓ Posicionado (ACK 3)</span>`;
    } else if (c.status === "ack2_valve" || c.ack2_at) {
      statusPill = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300">Na Válvula (ACK 2)</span>`;
    } else if (c.status === "ack1_master" || c.ack1_at) {
      statusPill = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/20 text-sky-300">No Mestre (ACK 1)</span>`;
    } else if (c.status === "timeout") {
      statusPill = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-400">✕ Sem Confirmação</span>`;
    }

    return `
      <tr class="hover:bg-wbm-surface/60 transition">
        <td class="py-2.5 px-3 font-mono text-zinc-300 whitespace-nowrap">${escapeHtml(formatDateTimeBR(c.sent_at))}</td>
        <td class="py-2.5 px-3 font-mono font-bold text-wbm-green">
          SM ${escapeHtml(c.sm)}${c.sm <= 100 ? "%" : ""}
          <span class="text-[10px] text-zinc-400 font-normal block">ED:${c.ed} MD:${c.md} • ${escapeHtml(c.topic || `devices/${c.device_id}/cmd`)}</span>
        </td>
        <td class="py-2.5 px-3 text-zinc-300">
          ${escapeHtml(c.origin || "MQTT")}
          <span class="text-[10px] text-zinc-500 block">Tent. ${c.attempt || 1}/${c.max_attempts || 1}</span>
        </td>
        <td class="py-2.5 px-3 font-mono ${c.ack1_at ? "text-sky-400" : "text-zinc-600"}">
          ${c.ack1_at ? `✓ ${formatTimeShort(c.ack1_at)} (+${d1 ?? 0}s)` : "---"}
        </td>
        <td class="py-2.5 px-3 font-mono ${c.ack2_at ? "text-amber-300" : "text-zinc-600"}">
          ${c.ack2_at ? `✓ ${formatTimeShort(c.ack2_at)} (+${d2 ?? 0}s)` : "---"}
        </td>
        <td class="py-2.5 px-3 font-mono ${ack3Iso ? "text-[#2ce610]" : "text-zinc-600"}">
          ${ack3Iso ? `✓ ${c.final_po ?? c.sm}% (+${d3 ?? 0}s)` : (c.final_po !== null && c.final_po !== undefined ? `Atual: ${c.final_po}%` : "---")}
        </td>
        <td class="py-2.5 px-3">${statusPill}</td>
      </tr>
    `;
  }).join("");
}

function renderErrorsHistoryTable(detail) {
  const errs = detail.error_history || [];
  const tbody = document.getElementById("errors-history-tbody");
  const badge = document.getElementById("errors-count-badge");
  if (badge) badge.textContent = `${errs.length} ocorrências`;
  if (!tbody) return;

  if (errs.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="py-6 text-center text-emerald-400/80">
          ✓ Nenhum código de erro registrado no histórico deste equipamento.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = errs.map(e => `
    <tr class="hover:bg-wbm-surface/60 transition">
      <td class="py-2 px-3 font-mono text-zinc-300 whitespace-nowrap">${escapeHtml(formatDateTimeBR(e.started_at))}</td>
      <td class="py-2 px-3 font-bold text-rose-400">
        Código ${escapeHtml(e.error_code)}
        <span class="block text-[10px] text-zinc-400 font-normal">${escapeHtml(e.error_desc || CF_ERRORS[e.error_code] || "")}</span>
      </td>
      <td class="py-2 px-3 font-mono text-zinc-300">
        Pos: ${e.po_at_error ?? "---"}%
        <span class="block text-[10px] text-amber-300">I: ${e.corrente_at_error ? Math.round(e.corrente_at_error) + " mA" : "N/D"}</span>
      </td>
      <td class="py-2 px-3 font-mono text-[11px]">
        ${e.resolved_at
          ? `<span class="text-emerald-400">✓ Resolvido às ${formatTimeShort(e.resolved_at)}</span>`
          : `<span class="text-rose-400 font-bold">● Ativo</span>`
        }
      </td>
    </tr>
  `).join("");
}

function setDeviceTopicTypeFilter(filterType) {
  state.deviceTopicTypeFilter = filterType || "ALL";
  localStorage.setItem("wbm_cf_dev_topic_filter", state.deviceTopicTypeFilter);
  renderDeviceMqttFeed(state.selectedDeviceId, state.currentDetail);
}

function renderDeviceMqttFeed(devId, detail = null) {
  const container = document.getElementById("device-mqtt-feed");
  const countBadge = document.getElementById("device-topics-count-badge");
  if (!container) return;

  const det = detail || state.currentDetail || {};
  const masterId = det?.config?.master_id || "";
  const dbFeed = det?.mqtt_feed_history || [];

  // Mescla pacotes vindos do SQLite deste dispositivo com os pacotes recentes em memória sem duplicar
  const seenKeys = new Set();
  const merged = [];
  const candidates = [
    ...state.recentFeed.filter(f => f.device_id === devId || (masterId && f.device_id === masterId) || (f.topic && f.topic.includes(devId))),
    ...dbFeed
  ];

  for (const item of candidates) {
    const key = `${item.created_at}_${item.topic}_${item.payload}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      merged.push(item);
    }
  }

  const filterType = state.deviceTopicTypeFilter || "ALL";
  const items = merged.filter(f => {
    if (filterType === "ALL") return true;
    const mt = String(f.msg_type || "").toLowerCase();
    if (filterType === "cmd") return mt.includes("cmd") || String(f.topic || "").endsWith("/cmd");
    if (filterType === "telemetry") return mt === "telemetry" || String(f.topic || "").endsWith("/telemetry");
    if (filterType === "status") return mt === "status" || String(f.topic || "").endsWith("/status");
    return true;
  });

  if (countBadge) {
    countBadge.textContent = `${items.length} pacote${items.length === 1 ? "" : "s"}`;
  }

  if (items.length === 0) {
    container.innerHTML = `<div class="text-zinc-500">Nenhum pacote registrado para o filtro atual nos tópicos devices/${escapeHtml(devId)}/...</div>`;
    return;
  }

  container.innerHTML = items.slice(0, 80).map(f => {
    let color = "text-zinc-300";
    let badge = "bg-zinc-800 text-zinc-300";
    if (f.msg_type === "telemetry") {
      color = "text-[#2ce610]";
      badge = "bg-[#2ce610]/20 text-[#2ce610]";
    } else if (f.msg_type === "status") {
      color = "text-amber-300";
      badge = "bg-amber-500/20 text-amber-300";
    } else if (String(f.msg_type || "").includes("cmd")) {
      color = "text-sky-400";
      badge = "bg-sky-500/20 text-sky-300";
    }

    return `
      <div class="border-b border-wbm-border/50 pb-1 flex flex-wrap items-baseline gap-1.5">
        <span class="text-zinc-500">[${formatDateTimeBR(f.created_at)}]</span>
        <span class="px-1.5 py-0.2 rounded text-[9px] font-bold uppercase ${badge}">${escapeHtml(f.msg_type || "mqtt")}</span>
        <span class="${color} font-bold">${escapeHtml(f.topic)}</span>
        <span class="text-zinc-200 break-all">→ ${escapeHtml(f.payload)}</span>
      </div>
    `;
  }).join("");
}

function renderDeviceIndividualBotLogs(devId, detail = null) {
  const box = document.getElementById("device-bot-log-box");
  const badge = document.getElementById("device-bot-log-count-badge");
  if (!box) return;

  const det = detail || state.currentDetail || {};
  const dbLogs = det?.bot_logs_history || [];
  const memLogs = state.botLogs.filter(l => l.device_id === devId || (l.message && l.message.includes(devId)));

  const seen = new Set();
  const merged = [];
  for (const l of [...memLogs, ...dbLogs]) {
    const k = `${l.created_at || l.time}_${l.message}`;
    if (!seen.has(k)) {
      seen.add(k);
      merged.push(l);
    }
  }

  if (badge) {
    badge.textContent = `${merged.length} evento${merged.length === 1 ? "" : "s"}`;
  }

  if (merged.length === 0) {
    box.innerHTML = `<div class="text-zinc-500">Nenhum evento de comando ou ciclo registrado individualmente para ${escapeHtml(devId)} ainda.</div>`;
    return;
  }

  box.innerHTML = merged.slice(0, 80).map(l => {
    let color = "text-zinc-200";
    if (l.message.includes("CONFIRMADO") || l.message.includes("concluído com sucesso")) color = "text-[#2ce610] font-bold";
    else if (l.message.includes("ALERTA") || l.message.includes("Erro") || l.message.includes("sem confirmação")) color = "text-rose-400 font-bold";
    else if (l.message.includes("Envio") || l.message.includes("Reenvio")) color = "text-sky-300";
    else if (l.message.includes("Configurações salvas") || l.message.includes("Bot iniciado")) color = "text-amber-300";

    return `
      <div class="border-b border-wbm-border/40 pb-1">
        <span class="text-zinc-500">[${escapeHtml(l.time || formatTimeShort(l.created_at))}]</span>
        <span class="${color}">${escapeHtml(l.message)}</span>
      </div>
    `;
  }).join("");
}

// ============================================================================
// Disparo de Comandos MQTT e Controle de Testes Automatizados
// ============================================================================
async function sendQuickCommand(smValue) {
  document.getElementById("cmd-sm").value = smValue;
  await sendManualCommandFromUI();
}

async function sendManualCommandFromUI() {
  if (!state.selectedDeviceId) return;
  const ed = Number(document.getElementById("cmd-ed").value || 1);
  const md = Number(document.getElementById("cmd-md").value || 2);
  const sm = Number(document.getElementById("cmd-sm").value || 100);
  const useMaster = document.getElementById("cmd-use-master-topic").checked;

  // Sincroniza o ED e MD escolhidos no modo manual com os campos do modo automático e estado local
  if (document.getElementById("auto-ed")) document.getElementById("auto-ed").value = ed;
  if (document.getElementById("auto-md")) document.getElementById("auto-md").value = md;
  const devObj = state.devices.find(d => d.device_id === state.selectedDeviceId);
  if (devObj) {
    devObj.ed = ed;
    devObj.md = md;
  }

  try {
    const res = await apiPost("/api/command", {
      device_id: state.selectedDeviceId,
      ed,
      md,
      sm,
      use_master_topic: useMaster,
      origin: "Manual (Aba do Equipamento)"
    });
    showToast(`🚀 Comando SM=${sm}${sm <= 100 ? "%" : ""} (ED:${ed}, MD:${md}) enviado para ${res.result.topic}!`);
    await refreshSelectedDeviceDetail(false);
  } catch (err) {
    showToast(`Erro ao enviar comando: ${err.message}`);
  }
}

function readTestParamsFromUI() {
  const edVal = Number(document.getElementById("auto-ed")?.value || document.getElementById("cmd-ed")?.value || 1);
  const mdVal = Number(document.getElementById("auto-md")?.value || document.getElementById("cmd-md")?.value || 2);
  if (document.getElementById("cmd-ed")) document.getElementById("cmd-ed").value = edVal;
  if (document.getElementById("cmd-md")) document.getElementById("cmd-md").value = mdVal;
  return {
    ed: edVal,
    md: mdVal,
    test_min: Number(document.getElementById("test-min").value || 1),
    test_max: Number(document.getElementById("test-max").value || 100),
    test_start_by: document.getElementById("test-start-by").value || "max",
    test_interval_min: Number(document.getElementById("test-interval").value || 10),
    test_timeout_min: Number(document.getElementById("test-timeout").value || 2),
    test_max_retries: Number(document.getElementById("test-retries").value || 3)
  };
}

async function saveManualConfigFromSingleTab(silent = false) {
  if (!state.selectedDeviceId) return;
  const ed = Number(document.getElementById("cmd-ed")?.value || 1);
  const md = Number(document.getElementById("cmd-md")?.value || 2);
  if (document.getElementById("auto-ed")) document.getElementById("auto-ed").value = ed;
  if (document.getElementById("auto-md")) document.getElementById("auto-md").value = md;

  const cfg = {
    ...(state.currentDetail.config || {}),
    device_id: state.selectedDeviceId,
    ...readTestParamsFromUI(),
    ed,
    md
  };
  const devObj = state.devices.find(d => d.device_id === state.selectedDeviceId);
  if (devObj) {
    devObj.ed = ed;
    devObj.md = md;
  }
  try {
    await apiPost("/api/devices", cfg);
    if (!silent) {
      showToast(`💾 [${state.selectedDeviceId}] Configuração salva em config.json (ED: ${ed} | Modo: ${md})!`);
      await pollServerState();
    }
  } catch (err) {
    if (!silent) showToast(`Erro ao salvar configuração: ${err.message}`);
  }
}

async function saveTestConfigOnly(silent = false) {
  if (!state.selectedDeviceId) return;
  const params = readTestParamsFromUI();
  const cfg = { ...(state.currentDetail.config || {}), device_id: state.selectedDeviceId, ...params };
  const devObj = state.devices.find(d => d.device_id === state.selectedDeviceId);
  if (devObj) Object.assign(devObj, params);
  try {
    await apiPost("/api/devices", cfg);
    if (!silent) {
      showToast("Parâmetros de teste salvos para este dispositivo!");
      await pollServerState();
    }
  } catch (err) {
    if (!silent) showToast(`Erro ao salvar: ${err.message}`);
  }
}

async function startAutomatedTestUI() {
  if (!state.selectedDeviceId) return;
  try {
    await apiPost("/api/test/start", {
      device_id: state.selectedDeviceId,
      params: readTestParamsFromUI()
    });
    showToast(`Ciclo automático de testes iniciado para ${state.selectedDeviceId}!`);
    await pollServerState();
  } catch (err) {
    showToast(`Erro ao iniciar teste: ${err.message}`);
  }
}

async function stopAutomatedTestUI() {
  if (!state.selectedDeviceId) return;
  try {
    const params = readTestParamsFromUI();
    const devObj = state.devices.find(d => d.device_id === state.selectedDeviceId);
    if (devObj) Object.assign(devObj, params);
    await apiPost("/api/test/stop", {
      device_id: state.selectedDeviceId,
      params
    });
    showToast(`Teste automatizado interrompido para ${state.selectedDeviceId}.`);
    await pollServerState();
  } catch (err) {
    showToast(`Erro ao parar teste: ${err.message}`);
  }
}

async function simulateTestBatteryForCurrentDevice() {
  if (!state.selectedDeviceId) return;
  try {
    await apiPost("/api/device/simulate", {
      device_id: state.selectedDeviceId,
      cycles: 6
    });
    state.reportDirty = false;
    showToast("Bateria de 6 ciclos de teste (Setpoints, Corrente mA, ACK 1/2/3 e Erro 3) gerada com sucesso!");
    await refreshSelectedDeviceDetail(false);
  } catch (err) {
    showToast(`Erro na simulação: ${err.message}`);
  }
}

// ============================================================================
// Sincronização de Cadastro (Nome, Local, Endereço) com o Lovable
// (Apenas metadados cadastrais; tópicos e acompanhamento são 100% via Broker MQTT)
// ============================================================================
async function syncWithSupabaseCloud(silent = false) {
  const statusEl = document.getElementById("supabase-status-text");
  if (statusEl) statusEl.textContent = "Lovable: Sincronizando cadastro...";
  try {
    const res = await apiPost("/api/device/sync_lovable_metadata", {});
    const info = res.result || {};
    const count = info.synced_count ?? 0;
    const total = info.total ?? state.devices.length;
    if (statusEl) statusEl.textContent = `Lovable: Cadastro sincronizado (${count}/${total})`;
    if (!silent) {
      showToast(`Cadastro sincronizado com o Lovable (Nome e Local atualizados para ${count} de ${total} dispositivos)!`);
    }
    await pollServerState();
  } catch (err) {
    if (statusEl) statusEl.textContent = "Lovable: Erro ao sincronizar cadastro";
    if (!silent) {
      showToast(`Erro ao sincronizar cadastro com Lovable: ${err.message}`);
    }
  }
}

// ============================================================================
// Geração Automática de Relatório Técnico Completo & Google Forms
// ============================================================================
function regenerateTechnicalReport() {
  const detail = state.currentDetail;
  if (!detail || !detail.config) return;

  const cfg = detail.config;
  const lv = detail.live || {};
  const tel = detail.telemetry_history || [];
  const cmds = detail.commands_audit || [];
  const errs = detail.error_history || [];

  const devId = cfg.device_id;
  const age = formatAge(lv.last_seen);
  const er = Number(lv.er || 0);
  const po = lv.po ?? (tel.length ? tel[tel.length - 1].po : 0);
  const sm = lv.sm ?? (cmds.length ? cmds[0].sm : po);
  const mdText = (lv.md ?? cfg.md) === 1 ? "Automático (1)" : "Manual (2)";

  // Estatísticas dos comandos de teste
  const posCmds = cmds.filter(c => c.sm >= 0 && c.sm <= 100);
  const ack1Count = posCmds.filter(c => c.ack1_at).length;
  const ack2Count = posCmds.filter(c => c.ack2_at).length;
  const ack3Count = posCmds.filter(c => c.ack3_at || c.pos_confirmed_at || c.status === "ack3_positioned" || c.status === "position_confirmed").length;
  const successRate = posCmds.length > 0 ? Math.round((ack3Count / posCmds.length) * 100) : 100;

  // Latência média de posicionamento
  const latencies = posCmds
    .map(c => diffSeconds(c.sent_at, c.ack3_at || c.pos_confirmed_at))
    .filter(v => v !== null);
  const avgLat = latencies.length > 0
    ? (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(1)
    : "N/D";

  // Estatísticas de corrente do motor
  const activeCurrents = tel.map(t => Number(t.corrente || 0)).filter(v => v > 200);
  const avgMovCurrent = activeCurrents.length > 0
    ? Math.round(activeCurrents.reduce((a, b) => a + b, 0) / activeCurrents.length)
    : Math.round(cfg.nominal_current_ma || 4000);
  const maxPeakCurrent = tel.length > 0
    ? Math.round(Math.max(...tel.map(t => Number(t.pico_corrente || t.corrente || 0))))
    : 0;
  const stallCurrent = Math.round(lv.corrente_trava || cfg.stall_current_ma || 7000);

  // Classificação operacional
  let statusOp = "Operando normalmente";
  let necAcao = "Nao";
  if (er === 7 || age.mins > 1440) {
    statusOp = "Sem comunicacao";
    necAcao = "Sim, acompanhamento";
  } else if (er !== 0 || successRate < 80) {
    statusOp = "Operando com observacoes";
    necAcao = "Sim, acompanhamento";
  }

  const resumoLines = [
    `[LAUDO TÉCNICO DE TESTES E ACOMPANHAMENTO - ${cfg.name.toUpperCase()}]`,
    `• Identificação Exclusiva (Device ID): ${devId} | Mestre: ${cfg.master_id} | Node (ed): ${cfg.ed} | Modo: ${mdText}.`,
    `• Estado Atual e Posicionamento: Válvula na posição física po=${po}% (Último Setpoint enviado sm=${sm}% -> ${isPositionConfirmed(sm, po) ? "POSIÇÃO CONFIRMADA" : "EM TRANSITO/DIVERGENTE"}). Acumulado mecânico: ${lv.qc ?? 0} ciclos (qc) e ${lv.qv ?? 0} voltas (qv). Última telemetria: ${formatDateTimeBR(lv.last_seen)} (${age.text}).`,
    `• Auditoria de Comandos e Handshake (Status 1, 2 e 3): Foram auditados ${posCmds.length} comando(s) de setpoint. Confirmações no Mestre (ACK 1): ${ack1Count}/${posCmds.length} | Recebidos pela Válvula via LoRa (ACK 2): ${ack2Count}/${posCmds.length} | Posicionamento físico confirmado (ACK 3): ${ack3Count}/${posCmds.length} (Taxa de sucesso: ${successRate}% | Tempo médio de posicionamento: ${avgLat}s).`,
    `• Perfil de Corrente do Motor (Sensor ACS): Corrente média em movimento de ${avgMovCurrent} mA, pico máximo registrado de ${maxPeakCurrent} mA e limiar de proteção/trava configurado em ${stallCurrent} mA.`,
    `• Histórico de Erros: Status atual er=${er} (${CF_ERRORS[er] || er}). Total de eventos de falha registrados no histórico: ${errs.length}.`
  ];

  const obsLines = [];
  if (errs.length > 0) {
    const lastErr = errs[0];
    obsLines.push(
      `Última ocorrência de erro: Código ${lastErr.error_code} (${lastErr.error_desc}) em ${formatDateTimeBR(lastErr.started_at)} na posição ${lastErr.po_at_error ?? "---"}% com corrente de ${Math.round(lastErr.corrente_at_error || 0)} mA (${lastErr.resolved_at ? "já normalizado" : "ainda ativo"}).`
    );
  } else {
    obsLines.push("Equipamento executou os ciclos de teste dentro dos limites nominais de corrente e torque, sem disparos de proteção (Erro 3) ou falhas de sensor indutivo (Erro 4/6).");
  }
  obsLines.push(`Broker MQTT: ${state.mqtt.broker || "163.176.56.133"}:${state.mqtt.port || 1883} | Tópico auditado: devices/${devId}/telemetry.`);

  document.getElementById("f-dataHora").value = getNowForGoogleForms();
  document.getElementById("f-statusOperacional").value = statusOp;
  document.getElementById("f-necessitaAcao").value = necAcao;
  document.getElementById("f-cliente").value = cfg.client || "ETA SAAE Itabirito";
  document.getElementById("f-equipamento").value = cfg.type === "MP" ? "Pressure Monitor" : "Control Flow Gate";
  document.getElementById("f-identificacao").value = devId === "Mestre_CC7B5CF20D9C_CF_1"
    ? "ControlFlow GATE 1  (ETA ITABIRITO)"
    : `${cfg.name} (${devId})`;
  document.getElementById("f-resumo").value = resumoLines.join("\n");
  document.getElementById("f-observacoes").value = obsLines.join("\n");
}

function setRadioOrOther(params, entryKey, validList, selectedValue) {
  if (validList.includes(selectedValue)) {
    params.set(entryKey, selectedValue);
  } else {
    params.set(entryKey, "__other_option__");
    params.set(`${entryKey}.other_option_response`, selectedValue || "");
  }
}

function buildGoogleFormsParamsFromUI() {
  const params = new URLSearchParams();
  params.set("usp", "pp_url");

  const dataHora = document.getElementById("f-dataHora").value.trim() || getNowForGoogleForms();
  const responsavel = document.getElementById("f-responsavel").value;
  const cliente = document.getElementById("f-cliente").value.trim();
  const equipamento = document.getElementById("f-equipamento").value.trim();
  const identificacao = document.getElementById("f-identificacao").value.trim();
  const tipoRegistro = document.getElementById("f-tipoRegistro").value;
  const statusOp = document.getElementById("f-statusOperacional").value;
  const necAcao = document.getElementById("f-necessitaAcao").value;
  const resumo = document.getElementById("f-resumo").value;
  const observacoes = document.getElementById("f-observacoes").value;

  params.set(FORM_ENTRIES.dataHora, dataHora);
  setRadioOrOther(params, FORM_ENTRIES.responsavel, FORM_OPTIONS.responsaveis, responsavel);
  setRadioOrOther(params, FORM_ENTRIES.cliente, FORM_OPTIONS.clientes, cliente);
  setRadioOrOther(params, FORM_ENTRIES.equipamento, FORM_OPTIONS.equipamentos, equipamento);
  setRadioOrOther(params, FORM_ENTRIES.identificacao, FORM_OPTIONS.identificacoes, identificacao);
  params.set(FORM_ENTRIES.tipoRegistro, tipoRegistro);
  params.set(FORM_ENTRIES.tipoAcompanhamento, "Remoto (somente sistema)");
  params.append(FORM_ENTRIES.fonteInformacoes, "Dados do supervisorio");
  params.append(FORM_ENTRIES.fonteInformacoes, "Historico do equipamento");
  params.set(FORM_ENTRIES.statusOperacional, statusOp);
  params.set(FORM_ENTRIES.necessitaAcao, necAcao);
  params.set(FORM_ENTRIES.resumo, resumo);
  params.set(FORM_ENTRIES.observacoes, observacoes);

  return { params, dataHora, identificacao };
}

function openPrefilledGoogleForm() {
  const { params } = buildGoogleFormsParamsFromUI();
  const url = `${GOOGLE_FORM_VIEW_URL}?${params.toString()}`;
  window.open(url, "_blank", "noopener,noreferrer");
  showToast("Google Forms aberto com todo o relatório de testes preenchido!");
}

async function submitDirectlyToGoogleForms() {
  const { params, dataHora, identificacao } = buildGoogleFormsParamsFromUI();
  params.delete("usp");
  params.delete(FORM_ENTRIES.dataHora);

  const dtMatch = dataHora.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  if (dtMatch) {
    params.set(`${FORM_ENTRIES.dataHora}_year`, dtMatch[1]);
    params.set(`${FORM_ENTRIES.dataHora}_month`, dtMatch[2]);
    params.set(`${FORM_ENTRIES.dataHora}_day`, dtMatch[3]);
    params.set(`${FORM_ENTRIES.dataHora}_hour`, dtMatch[4]);
    params.set(`${FORM_ENTRIES.dataHora}_minute`, dtMatch[5]);
  }
  params.set("fvv", "1");
  params.set("pageHistory", "0");

  try {
    await fetch(GOOGLE_FORM_POST_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString()
    });
    showToast(`Relatório de "${identificacao}" enviado diretamente para a planilha do Google Forms!`);
  } catch (err) {
    openPrefilledGoogleForm();
  }
}

function copyFullTechnicalReport() {
  const resumo = document.getElementById("f-resumo").value;
  const obs = document.getElementById("f-observacoes").value;
  const text = `${resumo}\n\nOBSERVAÇÕES E DIAGNÓSTICO:\n${obs}`;
  navigator.clipboard.writeText(text);
  showToast("Relatório técnico copiado para a área de transferência!");
}

function exportCurrentDeviceCSV() {
  const detail = state.currentDetail;
  if (!detail || !detail.config) return;
  const devId = detail.config.device_id;
  const cmds = detail.commands_audit || [];
  const tel = detail.telemetry_history || [];

  const lines = [
    "TIPO_REGISTRO,DATA_HORA,DEVICE_ID,ED,MD,SETPOINT_SM,POSICAO_PO,CORRENTE_MA,PICO_CORRENTE_MA,CICLOS_QC,VOLTAS_QV,ERRO_ER,ACK1_MESTRE,ACK2_VALVULA,ACK3_POSICIONADO,STATUS"
  ];

  for (const c of cmds) {
    lines.push([
      "COMANDO", c.sent_at, devId, c.ed, c.md, c.sm, c.final_po ?? "", "", "", "", "", "",
      c.ack1_at || "", c.ack2_at || "", c.ack3_at || c.pos_confirmed_at || "", c.status || ""
    ].join(","));
  }

  for (const t of tel) {
    lines.push([
      "TELEMETRIA", t.created_at, devId, t.ed, t.md, t.sm ?? "", t.po ?? "",
      t.corrente ?? 0, t.pico_corrente ?? 0, t.qc ?? "", t.qv ?? "", t.er ?? 0,
      "", "", "", t.source || "mqtt"
    ].join(","));
  }

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `relatorio_testes_${devId}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("Arquivo CSV com histórico de telemetria, corrente e comandos exportado!");
}

function scrollToReportSection() {
  regenerateTechnicalReport();
  document.getElementById("report-section")?.scrollIntoView({ behavior: "smooth" });
}

// ============================================================================
// Modais: Adicionar/Editar Aba de Equipamento, Arquitetura M2M e Broker MQTT
// ============================================================================
function openAddDeviceModal() {
  document.getElementById("device-modal-title").textContent = "Adicionar Novo Dispositivo (Aba & Automação Bot)";
  document.getElementById("mod-device-id").value = "";
  document.getElementById("mod-device-id").disabled = false;
  document.getElementById("mod-name").value = "";
  document.getElementById("mod-client").value = "WBM Technology";
  document.getElementById("mod-type").value = "CF";
  document.getElementById("mod-ed").value = "2";
  document.getElementById("mod-md").value = "2";
  document.getElementById("mod-test-min").value = "1";
  document.getElementById("mod-test-max").value = "100";
  document.getElementById("mod-test-start-by").value = "min";
  document.getElementById("mod-test-interval").value = "10";
  document.getElementById("mod-test-timeout").value = "2";
  document.getElementById("mod-test-retries").value = "3";
  document.getElementById("mod-local-ip").value = "";
  document.getElementById("mod-nom-curr").value = "4000";
  document.getElementById("mod-stall-curr").value = "7000";
  document.getElementById("device-modal")?.classList.remove("hidden");
}

function openEditCurrentDeviceModal() {
  const cfg = state.currentDetail?.config;
  if (!cfg) return;
  document.getElementById("device-modal-title").textContent = `Configurar Equipamento • ${cfg.device_id}`;
  document.getElementById("mod-device-id").value = cfg.device_id;
  document.getElementById("mod-name").value = cfg.name || "";
  document.getElementById("mod-client").value = cfg.client || "";
  document.getElementById("mod-type").value = cfg.type || "CF";
  document.getElementById("mod-ed").value = cfg.ed ?? 1;
  document.getElementById("mod-md").value = cfg.md ?? 2;
  document.getElementById("mod-test-min").value = cfg.test_min ?? 1;
  document.getElementById("mod-test-max").value = cfg.test_max ?? 100;
  document.getElementById("mod-test-start-by").value = cfg.test_start_by || "max";
  document.getElementById("mod-test-interval").value = cfg.test_interval_min ?? 10;
  document.getElementById("mod-test-timeout").value = cfg.test_timeout_min ?? 2;
  document.getElementById("mod-test-retries").value = cfg.test_max_retries ?? 3;
  document.getElementById("mod-local-ip").value = cfg.local_ip || "";
  document.getElementById("mod-nom-curr").value = cfg.nominal_current_ma ?? 4000;
  document.getElementById("mod-stall-curr").value = cfg.stall_current_ma ?? 7000;
  document.getElementById("device-modal")?.classList.remove("hidden");
}

function closeDeviceModal() {
  document.getElementById("device-modal")?.classList.add("hidden");
}

async function saveDeviceModalUI() {
  const devId = document.getElementById("mod-device-id").value.trim();
  if (!devId) {
    showToast("Informe o Device ID exclusivo (ex: Mestre_8813BF009744_CF_4)");
    return;
  }
  const vMin = Number(document.getElementById("mod-test-min").value ?? 1);
  const vMax = Number(document.getElementById("mod-test-max").value ?? 100);
  if (vMin < 0 || vMin > 100 || vMax < 0 || vMax > 100) {
    showToast("Os limites de porcentagem devem estar entre 0 e 100%.");
    return;
  }

  const payload = {
    device_id: devId,
    name: document.getElementById("mod-name").value.trim() || devId,
    client: document.getElementById("mod-client").value.trim() || "WBM Technology",
    type: document.getElementById("mod-type").value,
    ed: Number(document.getElementById("mod-ed").value || 1),
    md: Number(document.getElementById("mod-md").value || 2),
    test_min: vMin,
    test_max: vMax,
    test_start_by: document.getElementById("mod-test-start-by").value || "min",
    test_interval_min: Number(String(document.getElementById("mod-test-interval").value || 10).replace(",", ".")),
    test_timeout_min: Number(String(document.getElementById("mod-test-timeout").value || 2).replace(",", ".")),
    test_max_retries: Number(document.getElementById("mod-test-retries").value || 3),
    local_ip: document.getElementById("mod-local-ip").value.trim(),
    nominal_current_ma: Number(document.getElementById("mod-nom-curr").value || 4000),
    stall_current_ma: Number(document.getElementById("mod-stall-curr").value || 7000)
  };
  try {
    await apiPost("/api/devices", payload);
    closeDeviceModal();
    await pollServerState();
    if (state.activeView === "automation") {
      renderAutomationBotTab();
    } else {
      await selectDeviceTab(devId);
    }
    showToast(`Dispositivo '${devId}' (ED: ${payload.ed}) salvo em config.json (Limites: ${vMin}% a ${vMax}%)!`);
  } catch (err) {
    showToast(`Erro ao salvar equipamento: ${err.message}`);
  }
}

async function deleteCurrentDeviceUI() {
  const devId = document.getElementById("mod-device-id").value.trim();
  if (!devId) return;
  if (!confirm(`Deseja remover a aba do equipamento ${devId}?`)) return;
  try {
    await apiPost("/api/devices/delete", { device_id: devId });
    closeDeviceModal();
    state.selectedDeviceId = null;
    await pollServerState();
    showToast(`Aba ${devId} removida.`);
  } catch (err) {
    showToast(`Erro ao remover: ${err.message}`);
  }
}

function openMqttArchitectureModal() {
  document.getElementById("arch-modal")?.classList.remove("hidden");
}

function closeMqttArchitectureModal() {
  document.getElementById("arch-modal")?.classList.add("hidden");
}

function openBrokerSettingsModal() {
  document.getElementById("brk-host").value = state.mqtt.broker || "163.176.56.133";
  document.getElementById("brk-port").value = state.mqtt.port || 1883;
  document.getElementById("brk-user").value = state.mqtt.username || "wbm_technology";
  document.getElementById("broker-modal")?.classList.remove("hidden");
}

function closeBrokerSettingsModal() {
  document.getElementById("broker-modal")?.classList.add("hidden");
}

function openShareLinkModal() {
  updateShareLinkModalUI();
  document.getElementById("share-link-modal")?.classList.remove("hidden");
}

function closeShareLinkModal() {
  document.getElementById("share-link-modal")?.classList.add("hidden");
}

function updateShareLinkModalUI() {
  const links = state.accessLinks || {};
  const siteUrl = links.permanent_site_url || PUBLIC_WEB_SITE_URL;
  const lanUrl = links.primary_lan_url || `http://${window.location.hostname}:8090`;
  const lanInput = document.getElementById("share-lan-url-input");
  const pubInput = document.getElementById("share-public-url-input");
  const qrImg = document.getElementById("share-lan-qr-img");

  if (lanInput) lanInput.value = lanUrl;
  if (pubInput) pubInput.value = siteUrl;
  if (qrImg) {
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(siteUrl)}`;
  }
}

function copyAccessLink(inputId) {
  const el = document.getElementById(inputId);
  if (!el || !el.value) {
    showToast("Gere o link primeiro antes de copiar.");
    return;
  }
  navigator.clipboard.writeText(el.value);
  showToast(`🔗 Link copiado: ${el.value}`);
}

async function startPublicAccessLinkUI() {
  const pubBadge = document.getElementById("share-public-status-badge");
  if (pubBadge) {
    pubBadge.className = "px-2 py-0.5 text-[10px] font-bold rounded bg-amber-500/20 text-amber-300 animate-pulse";
    pubBadge.textContent = "Gerando link...";
  }
  try {
    const res = await apiPost("/api/access/public_tunnel", { action: "start" });
    await pollServerState();
    updateShareLinkModalUI();
    if (res.result?.public_url) {
      showToast(`🌐 Link externo gerado: ${res.result.public_url}`);
    } else {
      showToast("Iniciando túnel externo... aguarde alguns segundos.");
      setTimeout(async () => {
        await pollServerState();
        updateShareLinkModalUI();
      }, 3500);
    }
  } catch (err) {
    showToast(`Erro ao gerar link externo: ${err.message}`);
  }
}

async function stopPublicAccessLinkUI() {
  try {
    await apiPost("/api/access/public_tunnel", { action: "stop" });
    await pollServerState();
    updateShareLinkModalUI();
    showToast("Link externo desativado.");
  } catch (err) {
    showToast(`Erro: ${err.message}`);
  }
}

async function saveBrokerSettingsUI() {
  try {
    await apiPost("/api/broker/config", {
      host: document.getElementById("brk-host").value.trim(),
      port: Number(document.getElementById("brk-port").value || 1883),
      username: document.getElementById("brk-user").value.trim(),
      password: document.getElementById("brk-pass").value
    });
    closeBrokerSettingsModal();
    showToast("Configurações do Broker MQTT atualizadas! Reconectando...");
    setTimeout(pollServerState, 1500);
  } catch (err) {
    showToast(`Erro ao configurar Broker: ${err.message}`);
  }
}

// ============================================================================
// Inicialização
// ============================================================================
window.addEventListener("DOMContentLoaded", () => {
  // Relógio ao vivo
  setInterval(() => {
    const el = document.getElementById("live-clock");
    if (el) {
      el.textContent = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    }
  }, 1000);

  // Marca quando o usuário editar manualmente o texto do relatório para não sobrescrever durante a edição
  document.getElementById("f-resumo")?.addEventListener("input", () => { state.reportDirty = true; });
  document.getElementById("f-observacoes")?.addEventListener("input", () => { state.reportDirty = true; });

  // Restaura e auto-salva preferências do formulário de relatório e tópico mestre
  const fResp = document.getElementById("f-responsavel");
  const fTipo = document.getElementById("f-tipoRegistro");
  const chkMaster = document.getElementById("cmd-use-master-topic");
  const cmdSm = document.getElementById("cmd-sm");
  if (fResp && state.reportPrefs.responsavel) fResp.value = state.reportPrefs.responsavel;
  if (fTipo && state.reportPrefs.tipoRegistro) fTipo.value = state.reportPrefs.tipoRegistro;
  if (chkMaster) chkMaster.checked = Boolean(state.useMasterTopic);

  fResp?.addEventListener("change", e => saveReportPref("responsavel", e.target.value));
  fTipo?.addEventListener("change", e => saveReportPref("tipoRegistro", e.target.value));
  chkMaster?.addEventListener("change", e => {
    state.useMasterTopic = Boolean(e.target.checked);
    localStorage.setItem("wbm_cf_use_master_topic", String(state.useMasterTopic));
  });
  cmdSm?.addEventListener("input", e => {
    if (state.selectedDeviceId) saveManualSmValue(state.selectedDeviceId, e.target.value);
  });

  updateSingleTabCommandModeUI();
  pollServerState();
  // Sempre que abrir ou atualizar a página, sincroniza automaticamente Nome/Local com o Lovable
  syncWithSupabaseCloud(true);
  setInterval(pollServerState, 2500);

  // Ao voltar para a aba/app depois de muito tempo fora, sincroniza imediatamente o estado e retoma os Bots ativos
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      pollServerState();
    }
  });
  window.addEventListener("focus", () => {
    pollServerState();
  });
});
