export const cardActionTypes = [
  "save_contact",
  "call",
  "email",
  "whatsapp",
  "book_meeting",
  "custom_link",
  "download_pdf",
  "linkedin",
  "instagram",
  "facebook",
  "youtube",
] as const;

export type CardActionType = (typeof cardActionTypes)[number];

export type CardActionConfigItem = {
  id: string;
  type: CardActionType;
  visible: boolean;
  order: number;
  label?: string;
  file?: CardActionFileReference;
};

export type CardActionFileReference = {
  storage_path: string;
  file_name: string;
  mime_type?: string;
  size_bytes?: number;
  public_url?: string;
};

export type CardActionConfig = {
  version: 1;
  actions: CardActionConfigItem[];
};

export type TemplateAllowedActionItem = {
  type: CardActionType;
  enabled: boolean;
  default_visible?: boolean;
  default_label?: string;
};

export type TemplateAllowedActions = {
  version: 1;
  actions: TemplateAllowedActionItem[];
};

type ActionFieldKey =
  | "phone"
  | "email"
  | "whatsapp"
  | "booking_link"
  | "custom_url"
  | "linkedin"
  | "instagram"
  | "facebook"
  | "youtube";

export type CardActionDestinationField = ActionFieldKey;

type ActionCard = Partial<Record<ActionFieldKey, string | null | undefined>> & {
  action_config?: CardActionConfig | unknown | null;
  hidden_fields?: string[] | null;
  field_visibility?: Record<string, boolean> | null;
};

type ActionTemplate = {
  allowed_actions?: TemplateAllowedActions | unknown | null;
  allowed_fields?: string[] | null;
  supports_save_contact?: boolean | null;
};

const supportedActionTypeSet = new Set<string>(cardActionTypes);

export const cardActionDefinitions: {
  type: CardActionType;
  fieldKey?: CardActionDestinationField;
  label: string;
  destination: "none" | "scalar" | "file";
  labelConfigurable: boolean;
}[] = [
  { type: "save_contact", label: "Save Contact", destination: "none", labelConfigurable: false },
  { type: "call", fieldKey: "phone", label: "Call", destination: "scalar", labelConfigurable: false },
  { type: "email", fieldKey: "email", label: "Email", destination: "scalar", labelConfigurable: false },
  { type: "whatsapp", fieldKey: "whatsapp", label: "WhatsApp", destination: "scalar", labelConfigurable: false },
  { type: "book_meeting", fieldKey: "booking_link", label: "Book Meeting", destination: "scalar", labelConfigurable: false },
  { type: "custom_link", fieldKey: "custom_url", label: "Custom Link", destination: "scalar", labelConfigurable: true },
  { type: "download_pdf", label: "Download PDF", destination: "file", labelConfigurable: true },
  { type: "linkedin", fieldKey: "linkedin", label: "LinkedIn", destination: "scalar", labelConfigurable: false },
  { type: "instagram", fieldKey: "instagram", label: "Instagram", destination: "scalar", labelConfigurable: false },
  { type: "facebook", fieldKey: "facebook", label: "Facebook", destination: "scalar", labelConfigurable: false },
  { type: "youtube", fieldKey: "youtube", label: "YouTube", destination: "scalar", labelConfigurable: false },
];

const actionDefaults = cardActionDefinitions;

export function fieldKeyForActionType(type: CardActionType) {
  return cardActionDefinitions.find((definition) => definition.type === type)?.fieldKey;
}

export function defaultLabelForActionType(type: CardActionType) {
  return (
    cardActionDefinitions.find((definition) => definition.type === type)?.label ||
    type.replace(/_/g, " ")
  );
}

export function actionDefinitionForType(type: CardActionType) {
  return cardActionDefinitions.find((definition) => definition.type === type);
}

export function isStepThreeOwnedTemplateField(value: unknown) {
  if (typeof value !== "string") return false;

  const field = value.trim();

  return cardActionDefinitions.some(
    (definition) =>
      definition.fieldKey === field &&
      definition.fieldKey !== "email" &&
      definition.fieldKey !== "phone"
  );
}

export function actionLabelIsConfigurable(type: CardActionType) {
  return Boolean(actionDefinitionForType(type)?.labelConfigurable);
}

export function cardActionValue(
  card: Partial<Record<CardActionDestinationField, string | null | undefined>>,
  type: CardActionType
) {
  const fieldKey = fieldKeyForActionType(type);
  return fieldKey ? card[fieldKey] || "" : "";
}

export function actionNeedsDestination(type: CardActionType) {
  const definition = actionDefinitionForType(type);
  return definition?.destination === "scalar" || definition?.destination === "file";
}

export function actionFileReference(action: CardActionConfigItem) {
  return action.type === "download_pdf" ? action.file || null : null;
}

export function actionIsComplete(
  action: CardActionConfigItem,
  card: Partial<Record<CardActionDestinationField, string | null | undefined>>
) {
  const definition = actionDefinitionForType(action.type);

  if (!definition || definition.destination === "none") return true;

  if (definition.destination === "file") {
    return Boolean(actionFileReference(action)?.storage_path);
  }

  const fieldKey = fieldKeyForActionType(action.type);
  return fieldKey ? hasFieldValue(card[fieldKey]) : false;
}

export function normalizeCardActionConfig(value: unknown): CardActionConfig | null {
  if (!isRecord(value)) return null;
  if (!Array.isArray(value.actions) && !Array.isArray(value.items)) return null;

  const actions = Array.isArray(value.actions)
    ? value.actions
    : Array.isArray(value.items)
    ? value.items
    : [];

  const normalizedActions = normalizeActionItems(actions);

  return {
    version: 1,
    actions: normalizedActions,
  };
}

export function normalizeTemplateAllowedActions(
  value: unknown
): TemplateAllowedActions | null {
  if (!Array.isArray(value) && !(isRecord(value) && Array.isArray(value.actions))) {
    return null;
  }

  const rawActions = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.actions)
    ? value.actions
    : [];

  const seenTypes = new Set<CardActionType>();
  const actions: TemplateAllowedActionItem[] = [];
  const normalizedItems = rawActions.map((item) => {
    const record = typeof item === "string" ? { type: item } : item;
    if (!isRecord(record) || !isCardActionType(record.type)) return null;

    const type = record.type;
    if (seenTypes.has(type)) return null;
    seenTypes.add(type);

    return {
      type,
      enabled: record.enabled !== false,
      default_visible:
        typeof record.default_visible === "boolean"
          ? record.default_visible
          : undefined,
      default_label: normalizeActionLabel(record.default_label),
    };
  });

  normalizedItems.forEach((item) => {
    if (item?.enabled) actions.push(item);
  });

  return {
    version: 1,
    actions,
  };
}

export function effectiveAllowedActions(template: ActionTemplate | null | undefined) {
  const configured = normalizeTemplateAllowedActions(template?.allowed_actions);
  if (configured) return configured;

  const actions = actionDefaults
    .filter((definition) => {
      if (definition.type === "save_contact") {
        return template?.supports_save_contact !== false;
      }

      return Boolean(definition.fieldKey);
    })
    .map((definition) => ({
      type: definition.type,
      enabled: true,
      default_visible: true,
      default_label: definition.label,
    }));

  return {
    version: 1,
    actions,
  } satisfies TemplateAllowedActions;
}

export function effectiveCardActionConfig(
  card: ActionCard | null | undefined,
  template: ActionTemplate | null | undefined
): CardActionConfig {
  const configured = normalizeCardActionConfig(card?.action_config);

  if (configured) {
    return {
      version: 1,
      actions: configured.actions
        .map((action, index) => ({ ...action, order: index })),
    };
  }

  return deriveLegacyActionConfig(card, template);
}

export function defaultCardActionConfigForTemplate(
  template: ActionTemplate | null | undefined
): CardActionConfig | null {
  const allowedActions = normalizeTemplateAllowedActions(template?.allowed_actions);

  if (!allowedActions) return null;

  const actions = allowedActions.actions
    .filter((action) => action.default_visible === true)
    .map((action, index) => ({
      id: action.type,
      type: action.type,
      visible: true,
      order: index,
      label: actionLabelIsConfigurable(action.type)
        ? action.default_label || defaultLabelForActionType(action.type)
        : undefined,
    }));

  return {
    version: 1,
    actions,
  };
}

export function deriveLegacyActionConfig(
  card: ActionCard | null | undefined,
  template: ActionTemplate | null | undefined
): CardActionConfig {
  const allowedActions = effectiveAllowedActions(template);
  const actions: CardActionConfigItem[] = [];

  allowedActions.actions.forEach((allowedAction, index) => {
    const definition = actionDefaults.find(
      (defaultAction) => defaultAction.type === allowedAction.type
    );
    if (!definition) return;

    if (definition.fieldKey) {
      if (!isFieldVisible(definition.fieldKey, card)) return;
      if (!hasFieldValue(card?.[definition.fieldKey])) return;
    }

    actions.push({
      id: definition.type,
      type: definition.type,
      visible: allowedAction.default_visible ?? true,
      order: index,
      label: definition.labelConfigurable
        ? allowedAction.default_label || definition.label
        : undefined,
    });
  });

  return {
    version: 1,
    actions,
  };
}

export function isCardActionType(value: unknown): value is CardActionType {
  return typeof value === "string" && supportedActionTypeSet.has(value);
}

function normalizeActionItems(actions: unknown[]) {
  const seenTypes = new Set<CardActionType>();
  const normalizedActions: CardActionConfigItem[] = [];

  actions.forEach((item, index) => {
    if (!isRecord(item) || !isCardActionType(item.type)) return;

    const type = item.type;
    if (seenTypes.has(type)) return;
    seenTypes.add(type);

    normalizedActions.push({
      id: normalizeActionId(item.id, type),
      type,
      visible: item.visible !== false,
      order: normalizeOrder(item.order, index),
      label: actionLabelIsConfigurable(type)
        ? normalizeActionLabel(item.label)
        : undefined,
      file:
        type === "download_pdf"
          ? normalizeActionFileReference(item.file)
          : undefined,
    });
  });

  return normalizedActions
    .sort((first, second) => first.order - second.order)
    .map((item, index) => ({ ...item, order: index }));
}

function normalizeActionId(value: unknown, fallbackType: CardActionType) {
  if (typeof value !== "string") return fallbackType;

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);

  return normalized || fallbackType;
}

function normalizeActionLabel(value: unknown) {
  if (typeof value !== "string") return undefined;

  const normalized = value.trim().replace(/\s+/g, " ").slice(0, 80);
  return normalized || undefined;
}

function normalizeActionFileReference(value: unknown) {
  if (!isRecord(value)) return undefined;

  const storagePath = normalizeFileReferenceText(value.storage_path, 512);
  const fileName = normalizeFileReferenceText(value.file_name, 180);

  if (!storagePath || !fileName) return undefined;

  const mimeType = normalizeFileReferenceText(value.mime_type, 120);
  const publicUrl = normalizeFileReferenceText(value.public_url, 1024);
  const sizeBytes =
    typeof value.size_bytes === "number" &&
    Number.isFinite(value.size_bytes) &&
    value.size_bytes >= 0 &&
    value.size_bytes <= 50 * 1024 * 1024
      ? Math.round(value.size_bytes)
      : undefined;

  return {
    storage_path: storagePath,
    file_name: fileName,
    ...(mimeType ? { mime_type: mimeType } : {}),
    ...(sizeBytes !== undefined ? { size_bytes: sizeBytes } : {}),
    ...(publicUrl ? { public_url: publicUrl } : {}),
  } satisfies CardActionFileReference;
}

function normalizeFileReferenceText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;

  const normalized = value.trim().replace(/\s+/g, " ").slice(0, maxLength);
  return normalized || undefined;
}

function normalizeOrder(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isFieldVisible(field: string, card: ActionCard | null | undefined) {
  const visibility = card?.field_visibility || {};
  const storageKey = customFieldStorageKey(field);
  const hiddenFields = new Set(card?.hidden_fields || []);

  for (const key of fieldKeyVariants(field)) {
    if (typeof visibility[key] === "boolean") return visibility[key];
  }

  return !fieldKeyVariants(field).some((key) => hiddenFields.has(key)) &&
    !hiddenFields.has(storageKey);
}

function fieldKeyVariants(field: string) {
  const storageKey = customFieldStorageKey(field);
  return [
    field,
    storageKey,
    field.toLowerCase(),
    storageKey.toLowerCase(),
    `custom:personal:${storageKey}`,
    `custom:company:${storageKey}`,
    `custom:contact:${storageKey}`,
    `custom:social:${storageKey}`,
  ];
}

function customFieldStorageKey(field: string) {
  return field.startsWith("custom:")
    ? field.split(":").at(-1)?.trim().toLowerCase() || field
    : field;
}

function hasFieldValue(value: unknown) {
  return typeof value === "string" ? value.trim().length > 0 : Boolean(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
