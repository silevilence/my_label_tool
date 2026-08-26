use crate::i18n::zh_cn as text;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{Map, Value};
use std::collections::HashSet;
use std::path::{Component, Path};

pub const PLUGIN_MANIFEST_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginApiVersionTarget {
    pub min: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginEntry {
    pub command: String,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginCapabilityVersion {
    pub api_version: PluginApiVersionTarget,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginCapabilities {
    pub annotation_types: Vec<PluginAnnotationType>,
    pub batch: bool,
    pub progress: bool,
    pub cancel: bool,
    pub config_migration: bool,
    pub exporter: PluginCapabilityVersion,
    pub prelabel: PluginCapabilityVersion,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PluginExtensionKind {
    LabelPreset,
    Exporter,
    Prelabel,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PluginRuntime {
    Process,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PluginAnnotationType {
    Rect,
    Polygon,
    Point,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PluginPermission {
    FsRead(String),
    FsWrite(String),
    Network,
}

impl PluginPermission {
    fn parse(value: &str) -> Option<Self> {
        if value == "network" {
            return Some(Self::Network);
        }
        let (kind, target) = value.split_once(':')?;
        if !is_valid_permission_target(target) {
            return None;
        }
        let normalized_target = target.replace('\\', "/");
        match kind {
            "fs.read" => Some(Self::FsRead(normalized_target)),
            "fs.write" => Some(Self::FsWrite(normalized_target)),
            _ => None,
        }
    }

    pub fn manifest_value(&self) -> String {
        match self {
            Self::FsRead(target) => format!("fs.read:{target}"),
            Self::FsWrite(target) => format!("fs.write:{target}"),
            Self::Network => "network".to_string(),
        }
    }
}

impl Serialize for PluginPermission {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.manifest_value())
    }
}

impl<'de> Deserialize<'de> for PluginPermission {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::parse(&value).ok_or_else(|| serde::de::Error::custom(text::PLUGIN_PERMISSION_UNKNOWN))
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ManifestValidationErrorCode {
    Required,
    InvalidType,
    InvalidValue,
    InvalidFormat,
    InvalidVersion,
    InvalidPath,
    Forbidden,
    Duplicate,
    UnknownPermission,
    UnsupportedRuntime,
    UnsupportedVersion,
}

impl ManifestValidationErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Required => "REQUIRED",
            Self::InvalidType => "INVALID_TYPE",
            Self::InvalidValue => "INVALID_VALUE",
            Self::InvalidFormat => "INVALID_FORMAT",
            Self::InvalidVersion => "INVALID_VERSION",
            Self::InvalidPath => "INVALID_PATH",
            Self::Forbidden => "FORBIDDEN",
            Self::Duplicate => "DUPLICATE",
            Self::UnknownPermission => "UNKNOWN_PERMISSION",
            Self::UnsupportedRuntime => "UNSUPPORTED_RUNTIME",
            Self::UnsupportedVersion => "UNSUPPORTED_VERSION",
        }
    }

    fn from_name(value: &str) -> Self {
        match value {
            "REQUIRED" => Self::Required,
            "INVALID_TYPE" => Self::InvalidType,
            "INVALID_VALUE" => Self::InvalidValue,
            "INVALID_FORMAT" => Self::InvalidFormat,
            "INVALID_VERSION" => Self::InvalidVersion,
            "INVALID_PATH" => Self::InvalidPath,
            "FORBIDDEN" => Self::Forbidden,
            "DUPLICATE" => Self::Duplicate,
            "UNKNOWN_PERMISSION" => Self::UnknownPermission,
            "UNSUPPORTED_RUNTIME" => Self::UnsupportedRuntime,
            "UNSUPPORTED_VERSION" => Self::UnsupportedVersion,
            _ => unreachable!("内部插件清单校验错误码必须为已知常量"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub version: String,
    pub api_version: PluginApiVersionTarget,
    pub extension_kind: PluginExtensionKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime: Option<PluginRuntime>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry: Option<PluginEntry>,
    pub capabilities: PluginCapabilities,
    pub permissions: Vec<PluginPermission>,
    pub config_version: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManifestValidationError {
    pub field: String,
    pub code: ManifestValidationErrorCode,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManifestValidationResult {
    pub ok: bool,
    pub value: Option<PluginManifest>,
    pub errors: Vec<ManifestValidationError>,
}

pub fn parse_plugin_manifest(input: &Value) -> ManifestValidationResult {
    let Some(object) = input.as_object() else {
        return invalid(vec![validation_error(
            "$",
            "INVALID_TYPE",
            text::PLUGIN_MANIFEST_MUST_BE_OBJECT,
        )]);
    };
    let mut errors = Vec::new();

    let schema_version = parse_schema_version(object.get("schemaVersion"), &mut errors);
    let id = parse_required_string(object.get("id"), "id", &mut errors);
    if id.as_ref().is_some_and(|value| !is_valid_plugin_id(value)) {
        push_error(&mut errors, "id", "INVALID_FORMAT", text::PLUGIN_ID_INVALID);
    }
    let name = parse_required_string(object.get("name"), "name", &mut errors);
    let version = parse_required_string(object.get("version"), "version", &mut errors);
    if version
        .as_ref()
        .is_some_and(|value| !is_valid_semver(value))
    {
        push_error(
            &mut errors,
            "version",
            "INVALID_FORMAT",
            text::PLUGIN_VERSION_INVALID,
        );
    }
    let api_version = parse_api_version(object.get("apiVersion"), "apiVersion", &mut errors);
    let extension_kind = parse_extension_kind(object.get("extensionKind"), &mut errors);
    let runtime = parse_runtime(object.get("runtime"), extension_kind.as_ref(), &mut errors);
    let entry = parse_entry(object.get("entry"), extension_kind.as_ref(), &mut errors);
    let capabilities = parse_capabilities(
        object.get("capabilities"),
        extension_kind.as_ref(),
        api_version.as_ref(),
        &mut errors,
    );
    let permissions = parse_permissions(object.get("permissions"), &mut errors);
    let config_version = parse_bounded_u32(
        object.get("configVersion"),
        "configVersion",
        0,
        u32::MAX,
        0,
        &mut errors,
    );
    if !errors.is_empty() {
        return invalid(errors);
    }
    ManifestValidationResult {
        ok: true,
        value: Some(PluginManifest {
            schema_version: schema_version.unwrap_or(PLUGIN_MANIFEST_SCHEMA_VERSION),
            id: id.unwrap_or_default(),
            name: name.unwrap_or_default(),
            version: version.unwrap_or_default(),
            api_version: api_version.unwrap_or(PluginApiVersionTarget { min: 1 }),
            extension_kind: extension_kind.unwrap_or(PluginExtensionKind::LabelPreset),
            runtime,
            entry,
            capabilities,
            permissions,
            config_version,
        }),
        errors,
    }
}

fn parse_schema_version(
    value: Option<&Value>,
    errors: &mut Vec<ManifestValidationError>,
) -> Option<u32> {
    match value.and_then(Value::as_u64) {
        None if value.is_none() => {
            push_error(
                errors,
                "schemaVersion",
                "REQUIRED",
                text::PLUGIN_SCHEMA_VERSION_REQUIRED,
            );
            None
        }
        Some(version) if version == u64::from(PLUGIN_MANIFEST_SCHEMA_VERSION) => {
            Some(PLUGIN_MANIFEST_SCHEMA_VERSION)
        }
        _ => {
            push_error(
                errors,
                "schemaVersion",
                "UNSUPPORTED_VERSION",
                text::PLUGIN_SCHEMA_VERSION_UNSUPPORTED,
            );
            None
        }
    }
}

fn parse_extension_kind(
    value: Option<&Value>,
    errors: &mut Vec<ManifestValidationError>,
) -> Option<PluginExtensionKind> {
    match value.and_then(Value::as_str) {
        Some("label-preset") => Some(PluginExtensionKind::LabelPreset),
        Some("exporter") => Some(PluginExtensionKind::Exporter),
        Some("prelabel") => Some(PluginExtensionKind::Prelabel),
        None if value.is_none() => {
            push_error(
                errors,
                "extensionKind",
                "REQUIRED",
                text::PLUGIN_EXTENSION_KIND_REQUIRED,
            );
            None
        }
        _ => {
            push_error(
                errors,
                "extensionKind",
                "INVALID_VALUE",
                text::PLUGIN_EXTENSION_KIND_UNSUPPORTED,
            );
            None
        }
    }
}

fn parse_runtime(
    value: Option<&Value>,
    extension_kind: Option<&PluginExtensionKind>,
    errors: &mut Vec<ManifestValidationError>,
) -> Option<PluginRuntime> {
    if extension_kind == Some(&PluginExtensionKind::LabelPreset) {
        if value.is_some() {
            push_error(
                errors,
                "runtime",
                "FORBIDDEN",
                text::PLUGIN_DATA_RUNTIME_FORBIDDEN,
            );
        }
        return None;
    }
    match value.and_then(Value::as_str) {
        Some("process") => Some(PluginRuntime::Process),
        None if value.is_none() => {
            if extension_kind.is_some() {
                push_error(
                    errors,
                    "runtime",
                    "REQUIRED",
                    text::PLUGIN_CODE_RUNTIME_REQUIRED,
                );
            }
            None
        }
        _ => {
            push_error(
                errors,
                "runtime",
                "UNSUPPORTED_RUNTIME",
                text::PLUGIN_RUNTIME_UNSUPPORTED,
            );
            None
        }
    }
}

fn parse_entry(
    value: Option<&Value>,
    extension_kind: Option<&PluginExtensionKind>,
    errors: &mut Vec<ManifestValidationError>,
) -> Option<PluginEntry> {
    if extension_kind == Some(&PluginExtensionKind::LabelPreset) {
        if value.is_some() {
            push_error(
                errors,
                "entry",
                "FORBIDDEN",
                text::PLUGIN_DATA_ENTRY_FORBIDDEN,
            );
        }
        return None;
    }
    let Some(value) = value else {
        if extension_kind.is_some() {
            push_error(
                errors,
                "entry",
                "REQUIRED",
                text::PLUGIN_CODE_ENTRY_REQUIRED,
            );
        }
        return None;
    };
    let Some(object) = value.as_object() else {
        push_error(
            errors,
            "entry",
            "INVALID_TYPE",
            text::PLUGIN_ENTRY_MUST_BE_OBJECT,
        );
        return None;
    };
    let command = parse_required_string(object.get("command"), "entry.command", errors);
    if command
        .as_ref()
        .is_some_and(|value| !is_safe_relative_path(value))
    {
        push_error(
            errors,
            "entry.command",
            "INVALID_PATH",
            text::PLUGIN_ENTRY_PATH_INVALID,
        );
    }
    let args = parse_string_array(object.get("args"), "entry.args", errors);
    command
        .filter(|value| is_safe_relative_path(value))
        .map(|command| PluginEntry { command, args })
}

fn parse_capabilities(
    value: Option<&Value>,
    extension_kind: Option<&PluginExtensionKind>,
    overall_api_version: Option<&PluginApiVersionTarget>,
    errors: &mut Vec<ManifestValidationError>,
) -> PluginCapabilities {
    let empty = Map::new();
    let object = match value {
        None => &empty,
        Some(Value::Object(object)) => object,
        Some(_) => {
            push_error(
                errors,
                "capabilities",
                "INVALID_TYPE",
                text::PLUGIN_CAPABILITIES_MUST_BE_OBJECT,
            );
            &empty
        }
    };
    let annotation_types = parse_annotation_types(object.get("annotationTypes"), errors);
    if extension_kind == Some(&PluginExtensionKind::Prelabel) && annotation_types.is_empty() {
        push_error(
            errors,
            "capabilities.annotationTypes",
            "REQUIRED",
            text::PLUGIN_PRELABEL_ANNOTATION_TYPES_REQUIRED,
        );
    }
    let fallback = overall_api_version
        .cloned()
        .unwrap_or(PluginApiVersionTarget { min: 1 });
    PluginCapabilities {
        annotation_types,
        batch: parse_optional_bool(object.get("batch"), "capabilities.batch", errors),
        progress: parse_optional_bool(object.get("progress"), "capabilities.progress", errors),
        cancel: parse_optional_bool(object.get("cancel"), "capabilities.cancel", errors),
        config_migration: parse_optional_bool(
            object.get("configMigration"),
            "capabilities.configMigration",
            errors,
        ),
        exporter: PluginCapabilityVersion {
            api_version: parse_capability_api_version(
                object.get("exporter"),
                "capabilities.exporter",
                errors,
            )
            .unwrap_or_else(|| fallback.clone()),
        },
        prelabel: PluginCapabilityVersion {
            api_version: parse_capability_api_version(
                object.get("prelabel"),
                "capabilities.prelabel",
                errors,
            )
            .unwrap_or(fallback),
        },
    }
}

fn parse_capability_api_version(
    value: Option<&Value>,
    field: &str,
    errors: &mut Vec<ManifestValidationError>,
) -> Option<PluginApiVersionTarget> {
    let value = value?;
    let Some(object) = value.as_object() else {
        push_error(
            errors,
            field,
            "INVALID_TYPE",
            text::PLUGIN_CAPABILITY_VERSION_MUST_BE_OBJECT,
        );
        return None;
    };
    parse_api_version(
        object.get("apiVersion"),
        &format!("{field}.apiVersion"),
        errors,
    )
}

fn parse_api_version(
    value: Option<&Value>,
    field: &str,
    errors: &mut Vec<ManifestValidationError>,
) -> Option<PluginApiVersionTarget> {
    let Some(value) = value else {
        push_error(errors, field, "REQUIRED", text::PLUGIN_API_VERSION_REQUIRED);
        return None;
    };
    let Some(object) = value.as_object() else {
        push_error(
            errors,
            field,
            "INVALID_TYPE",
            text::PLUGIN_API_VERSION_MUST_BE_OBJECT,
        );
        return None;
    };
    for key in object.keys().filter(|key| key.as_str() != "min") {
        push_error(
            errors,
            &format!("{field}.{key}"),
            "FORBIDDEN",
            text::PLUGIN_API_VERSION_ONLY_MIN,
        );
    }
    match object.get("min").and_then(Value::as_u64) {
        Some(min) if min > 0 && min <= u64::from(u32::MAX) => {
            Some(PluginApiVersionTarget { min: min as u32 })
        }
        _ => {
            push_error(
                errors,
                &format!("{field}.min"),
                "INVALID_VERSION",
                text::PLUGIN_API_VERSION_INVALID,
            );
            None
        }
    }
}

fn parse_annotation_types(
    value: Option<&Value>,
    errors: &mut Vec<ManifestValidationError>,
) -> Vec<PluginAnnotationType> {
    let Some(value) = value else {
        return Vec::new();
    };
    let Some(items) = value.as_array() else {
        push_error(
            errors,
            "capabilities.annotationTypes",
            "INVALID_TYPE",
            text::PLUGIN_ANNOTATION_TYPES_MUST_BE_ARRAY,
        );
        return Vec::new();
    };
    let mut result = Vec::new();
    for (index, item) in items.iter().enumerate() {
        let field = format!("capabilities.annotationTypes[{index}]");
        match item.as_str() {
            Some("rect") if !result.contains(&PluginAnnotationType::Rect) => {
                result.push(PluginAnnotationType::Rect);
            }
            Some("polygon") if !result.contains(&PluginAnnotationType::Polygon) => {
                result.push(PluginAnnotationType::Polygon);
            }
            Some("point") if !result.contains(&PluginAnnotationType::Point) => {
                result.push(PluginAnnotationType::Point);
            }
            Some("rect" | "polygon" | "point") => {
                push_error(
                    errors,
                    &field,
                    "DUPLICATE",
                    text::PLUGIN_ANNOTATION_TYPE_DUPLICATE,
                );
            }
            _ => push_error(
                errors,
                &field,
                "INVALID_VALUE",
                text::PLUGIN_ANNOTATION_TYPE_UNSUPPORTED,
            ),
        }
    }
    result
}

fn parse_permissions(
    value: Option<&Value>,
    errors: &mut Vec<ManifestValidationError>,
) -> Vec<PluginPermission> {
    let Some(value) = value else {
        return Vec::new();
    };
    let Some(items) = value.as_array() else {
        push_error(
            errors,
            "permissions",
            "INVALID_TYPE",
            text::PLUGIN_PERMISSIONS_MUST_BE_ARRAY,
        );
        return Vec::new();
    };
    let mut result = Vec::new();
    let mut seen = HashSet::new();
    for (index, item) in items.iter().enumerate() {
        let field = format!("permissions[{index}]");
        let Some(permission) = item.as_str() else {
            push_error(
                errors,
                &field,
                "UNKNOWN_PERMISSION",
                text::PLUGIN_PERMISSION_UNKNOWN,
            );
            continue;
        };
        let Some(parsed) = PluginPermission::parse(permission) else {
            push_error(
                errors,
                &field,
                "UNKNOWN_PERMISSION",
                text::PLUGIN_PERMISSION_UNKNOWN,
            );
            continue;
        };
        let normalized = parsed.manifest_value();
        if !seen.insert(normalized) {
            push_error(
                errors,
                &field,
                "DUPLICATE",
                text::PLUGIN_PERMISSION_DUPLICATE,
            );
        } else {
            result.push(parsed);
        }
    }
    result
}

fn parse_required_string(
    value: Option<&Value>,
    field: &str,
    errors: &mut Vec<ManifestValidationError>,
) -> Option<String> {
    let Some(value) = value else {
        push_error(
            errors,
            field,
            "REQUIRED",
            &text::plugin_required_field(field),
        );
        return None;
    };
    let Some(value) = value.as_str() else {
        push_error(
            errors,
            field,
            "INVALID_TYPE",
            &text::plugin_field_must_be_string(field),
        );
        return None;
    };
    if value.trim().is_empty() {
        push_error(
            errors,
            field,
            "INVALID_VALUE",
            &text::plugin_field_must_not_be_empty(field),
        );
        return None;
    }
    Some(value.to_string())
}

fn parse_string_array(
    value: Option<&Value>,
    field: &str,
    errors: &mut Vec<ManifestValidationError>,
) -> Vec<String> {
    let Some(value) = value else {
        return Vec::new();
    };
    let Some(items) = value.as_array() else {
        push_error(
            errors,
            field,
            "INVALID_TYPE",
            &text::plugin_field_must_be_string_array(field),
        );
        return Vec::new();
    };
    let mut result = Vec::new();
    for (index, item) in items.iter().enumerate() {
        if let Some(item) = item.as_str() {
            result.push(item.to_string());
        } else {
            push_error(
                errors,
                &format!("{field}[{index}]"),
                "INVALID_TYPE",
                text::PLUGIN_COMMAND_ARGUMENT_MUST_BE_STRING,
            );
        }
    }
    result
}

fn parse_optional_bool(
    value: Option<&Value>,
    field: &str,
    errors: &mut Vec<ManifestValidationError>,
) -> bool {
    match value {
        None => false,
        Some(Value::Bool(value)) => *value,
        Some(_) => {
            push_error(
                errors,
                field,
                "INVALID_TYPE",
                &text::plugin_field_must_be_boolean(field),
            );
            false
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn parse_bounded_u32(
    value: Option<&Value>,
    field: &str,
    minimum: u32,
    maximum: u32,
    fallback: u32,
    errors: &mut Vec<ManifestValidationError>,
) -> u32 {
    let Some(value) = value else {
        return fallback;
    };
    match value.as_u64() {
        Some(value) if value >= u64::from(minimum) && value <= u64::from(maximum) => value as u32,
        _ => {
            push_error(
                errors,
                field,
                "INVALID_VALUE",
                &text::plugin_field_must_be_bounded_integer(field, minimum, maximum),
            );
            fallback
        }
    }
}

pub(crate) fn is_valid_plugin_id(value: &str) -> bool {
    let parts: Vec<_> = value.split('.').collect();
    parts.len() >= 2
        && parts.iter().all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        })
}

pub(crate) fn is_valid_semver(value: &str) -> bool {
    let without_build = value.split_once('+').map_or(value, |(core, build)| {
        if build.is_empty() || !valid_semver_identifiers(build, false) {
            return "";
        }
        core
    });
    if without_build.is_empty() {
        return false;
    }
    let (core, pre_release) = without_build
        .split_once('-')
        .map_or((without_build, None), |(core, pre)| (core, Some(pre)));
    if pre_release.is_some_and(|pre| pre.is_empty() || !valid_semver_identifiers(pre, true)) {
        return false;
    }
    let parts: Vec<_> = core.split('.').collect();
    parts.len() == 3 && parts.iter().all(|part| valid_numeric_identifier(part))
}

fn valid_semver_identifiers(value: &str, reject_leading_zero_numbers: bool) -> bool {
    value.split('.').all(|part| {
        !part.is_empty()
            && part
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
            && (!reject_leading_zero_numbers
                || !part.bytes().all(|byte| byte.is_ascii_digit())
                || valid_numeric_identifier(part))
    })
}

fn valid_numeric_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.bytes().all(|byte| byte.is_ascii_digit())
        && (value == "0" || !value.starts_with('0'))
}

pub(crate) fn is_safe_relative_path(value: &str) -> bool {
    let normalized = value.replace('\\', "/");
    !value.is_empty()
        && !has_windows_drive_prefix(value)
        && !Path::new(value).is_absolute()
        && !value.starts_with(['/', '\\'])
        && normalized
            .split('/')
            .all(|segment| !segment.is_empty() && segment != "." && segment != "..")
        && Path::new(value).components().all(|component| {
            !matches!(
                component,
                Component::ParentDir
                    | Component::RootDir
                    | Component::Prefix(_)
                    | Component::CurDir
            )
        })
}

fn has_windows_drive_prefix(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

pub(crate) fn is_valid_permission_target(target: &str) -> bool {
    let normalized = target.replace('\\', "/");
    let mut segments = normalized.split('/');
    matches!(
        segments.next(),
        Some("%PROJECT%" | "%MODELS%" | "%APP_DATA%")
    ) && segments.all(|segment| !segment.is_empty() && segment != "." && segment != "..")
        && !target.contains('\0')
}

fn invalid(errors: Vec<ManifestValidationError>) -> ManifestValidationResult {
    ManifestValidationResult {
        ok: false,
        value: None,
        errors,
    }
}

fn validation_error(field: &str, code: &str, reason: &str) -> ManifestValidationError {
    ManifestValidationError {
        field: field.to_string(),
        code: ManifestValidationErrorCode::from_name(code),
        reason: reason.to_string(),
    }
}

fn push_error(errors: &mut Vec<ManifestValidationError>, field: &str, code: &str, reason: &str) {
    errors.push(validation_error(field, code, reason));
}

#[cfg(test)]
#[path = "manifest_tests.rs"]
mod tests;
