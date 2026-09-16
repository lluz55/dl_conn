/* Custom services: validated local schema, host-safe merge and config export. */

export const CUSTOM_SERVICES_STORAGE_KEY = "dl_conn_custom_services_v1";
export const CUSTOM_SERVICES_SCHEMA_VERSION = 1;

export const SAFE_SERVICE_ICONS = Object.freeze([
  "home", "video", "camera", "router", "wifi", "server", "database",
  "dashboard", "activity", "terminal", "code", "shield", "cloud", "globe",
  "music", "film", "tv", "hard-drive", "cpu", "zap", "sliders", "bell",
  "thermometer", "printer", "download", "lightbulb", "docker", "eye",
  "folder", "package",
]);

export const CUSTOM_SERVICE_STRINGS = Object.freeze({
  invalidName: "Informe o nome do serviço.",
  invalidPort: "Informe uma porta entre 1024 e 65535.",
  invalidIcon: "Escolha um ícone da lista.",
  addedTemporary: "Serviço temporário adicionado. Ele será removido ao recarregar a página.",
  addedPersisted: "Serviço adicionado e salvo neste navegador.",
  addedButNotPersisted: "Serviço adicionado, mas não foi possível salvar neste dispositivo. Ele some ao recarregar a página.",
  deleted: "Serviço personalizado removido.",
  deletedButNotPersisted: "Removido apenas nesta sessão; ele pode reaparecer ao recarregar, pois não foi possível atualizar o armazenamento local.",
  clearedButNotPersisted: "Lista limpa nesta sessão; os serviços salvos podem reaparecer ao recarregar, pois não foi possível atualizar o armazenamento local.",
  noCustomServices: "Adicione ao menos um serviço personalizado antes de exportar.",
  exportYaml: "Fragmento YAML baixado. Mescle a seção services ao config.yaml permanente.",
  exportNix: "Fragmento Nix baixado. Mescle a lista em services.dl-conn.settings.services.",
  customBadge: "Personalizado",
  persistedBadge: "salvo localmente",
  temporaryBadge: "temporário",
  unprobed: "Saúde não monitorada (acesso local temporário)",
  deleteLabel: "Excluir serviço personalizado",
});

const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 240;
const MAX_ID_LENGTH = 48;

// Route prefixes the daemon's own mux always owns (cmd/dl_conn/main.go
// registers "/auth", "/auth/logout" and "/local/" unconditionally, before
// any configured or exported service). A custom service whose sanitized id
// happens to be "auth" or "local" would export a colliding "/auth"/"/local"
// prefix; merging that fragment into config.yaml (or settings.services)
// makes the daemon panic on duplicate http.ServeMux registration at
// startup. Always reserved regardless of what the host currently advertises.
const RESERVED_INTERNAL_IDS = Object.freeze(["auth", "local"]);

function cleanText(value, maxLength) {
  return String(value == null ? "" : value).trim().slice(0, maxLength);
}

export function sanitizeServiceId(name) {
  const normalized = cleanText(name, MAX_NAME_LENGTH)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_ID_LENGTH)
    .replace(/-+$/g, "");
  return normalized || "servico";
}

function reservedNames(hostServices, customServices) {
  const reserved = new Set(RESERVED_INTERNAL_IDS);
  for (const service of hostServices || []) {
    const id = cleanText(service && service.id, MAX_ID_LENGTH).toLowerCase();
    const prefix = cleanText(service && service.prefix, MAX_ID_LENGTH + 1)
      .replace(/^\/+|\/+$/g, "").toLowerCase();
    if (id) reserved.add(id);
    if (prefix) reserved.add(prefix);
  }
  for (const service of customServices || []) {
    const id = cleanText(service && service.configId, MAX_ID_LENGTH).toLowerCase();
    if (id) reserved.add(id);
  }
  return reserved;
}

function uniqueServiceId(base, reserved) {
  let candidate = base;
  let suffix = 2;
  while (reserved.has(candidate)) {
    const ending = "-" + suffix++;
    candidate = base.slice(0, MAX_ID_LENGTH - ending.length).replace(/-+$/g, "") + ending;
  }
  return candidate;
}

function validateInput(input) {
  const name = cleanText(input && input.name, MAX_NAME_LENGTH);
  const description = cleanText(input && input.description, MAX_DESCRIPTION_LENGTH);
  const port = Number(input && input.port);
  const icon = cleanText(input && input.icon, 32).toLowerCase();
  if (!name) throw new Error(CUSTOM_SERVICE_STRINGS.invalidName);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(CUSTOM_SERVICE_STRINGS.invalidPort);
  }
  if (!SAFE_SERVICE_ICONS.includes(icon)) {
    throw new Error(CUSTOM_SERVICE_STRINGS.invalidIcon);
  }
  return { name, description, port, icon };
}

export function createCustomService(input, hostServices = [], customServices = []) {
  const validated = validateInput(input);
  const base = sanitizeServiceId(validated.name);
  const configId = uniqueServiceId(base, reservedNames(hostServices, customServices));
  return {
    configId,
    name: validated.name,
    description: validated.description,
    port: validated.port,
    icon: validated.icon,
    websocket: Boolean(input && input.websocket),
    persisted: Boolean(input && input.persisted),
  };
}

function validStoredService(value) {
  if (!value || typeof value !== "object") return null;
  try {
    const validated = validateInput(value);
    const configId = cleanText(value.configId, MAX_ID_LENGTH).toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(configId)) return null;
    return {
      configId,
      name: validated.name,
      description: validated.description,
      port: validated.port,
      icon: validated.icon,
      websocket: Boolean(value.websocket),
      persisted: true,
    };
  } catch (_) {
    return null;
  }
}

export function parseCustomServices(raw) {
  if (!raw) return [];
  try {
    const payload = JSON.parse(raw);
    if (!payload || payload.version !== CUSTOM_SERVICES_SCHEMA_VERSION || !Array.isArray(payload.services)) {
      return [];
    }
    const seen = new Set();
    const services = [];
    for (const item of payload.services) {
      const service = validStoredService(item);
      if (!service || seen.has(service.configId)) continue;
      seen.add(service.configId);
      services.push(service);
    }
    return services;
  } catch (_) {
    return [];
  }
}

export function serializeCustomServices(customServices) {
  const services = (customServices || [])
    .filter((service) => service && service.persisted)
    .map((service) => ({
      configId: service.configId,
      name: service.name,
      description: service.description || "",
      port: service.port,
      icon: service.icon,
      websocket: Boolean(service.websocket),
    }));
  return JSON.stringify({ version: CUSTOM_SERVICES_SCHEMA_VERSION, services });
}

export function reconcileCustomServices(customServices, hostServices) {
  const reserved = reservedNames(hostServices, []);
  return (customServices || []).map((service) => {
    const base = sanitizeServiceId(service.configId || service.name);
    const configId = uniqueServiceId(base, reserved);
    reserved.add(configId);
    return configId === service.configId ? service : { ...service, configId };
  });
}

export function mergeHostAndCustomServices(hostServices, customServices) {
  const host = Array.isArray(hostServices) ? hostServices.slice() : [];
  const custom = reconcileCustomServices(customServices, host);
  const runtimeIds = new Set(host.map((service) => String(service && service.id || "")));
  const runtimeCustom = custom.map((service) => {
    const baseRuntimeId = "custom:" + service.configId;
    let runtimeId = baseRuntimeId;
    let suffix = 2;
    while (runtimeIds.has(runtimeId)) runtimeId = baseRuntimeId + ":" + suffix++;
    runtimeIds.add(runtimeId);
    return {
      id: runtimeId,
      configId: service.configId,
      name: service.name,
      description: service.description,
      icon: service.icon,
      port: service.port,
      websocket: service.websocket,
      persisted: service.persisted,
      prefix: "/local/" + service.port,
      status: "unknown",
      custom: true,
    };
  });
  return { customServices: custom, services: host.concat(runtimeCustom) };
}

function yamlString(value) {
  return JSON.stringify(String(value));
}

function nixString(value) {
  return '"' + String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$\{/g, "\\${")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t") + '"';
}

function permanentService(service) {
  return {
    id: service.configId,
    name: service.name,
    icon: service.icon,
    description: service.description || "",
    prefix: "/" + service.configId,
    target: "http://127.0.0.1:" + service.port,
    stripPrefix: true,
    websocket: Boolean(service.websocket),
  };
}

export function exportCustomServicesYaml(customServices) {
  const rows = (customServices || []).map(permanentService);
  const lines = [
    "# dl_conn — fragmento de serviços personalizados",
    "# Mescle estes itens na seção services do seu config.yaml permanente.",
    "services:",
  ];
  for (const service of rows) {
    lines.push("  - id: " + yamlString(service.id));
    lines.push("    name: " + yamlString(service.name));
    lines.push("    icon: " + yamlString(service.icon));
    lines.push("    description: " + yamlString(service.description));
    lines.push("    prefix: " + yamlString(service.prefix));
    lines.push("    target: " + yamlString(service.target));
    lines.push("    stripPrefix: true");
    lines.push("    websocket: " + String(service.websocket));
  }
  return lines.join("\n") + "\n";
}

export function exportCustomServicesNix(customServices) {
  const rows = (customServices || []).map(permanentService);
  const lines = [
    "# dl_conn — fragmento de serviços personalizados",
    "# Mescle estes itens em services.dl-conn.settings.services.",
    "[",
  ];
  for (const service of rows) {
    lines.push("  {");
    lines.push("    id = " + nixString(service.id) + ";");
    lines.push("    name = " + nixString(service.name) + ";");
    lines.push("    icon = " + nixString(service.icon) + ";");
    lines.push("    description = " + nixString(service.description) + ";");
    lines.push("    prefix = " + nixString(service.prefix) + ";");
    lines.push("    target = " + nixString(service.target) + ";");
    lines.push("    stripPrefix = true;");
    lines.push("    websocket = " + String(service.websocket) + ";");
    lines.push("  }");
  }
  lines.push("]");
  return lines.join("\n") + "\n";
}
