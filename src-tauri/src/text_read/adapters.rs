use super::{Config, Field, Mode, Plan};
use crate::i18n::zh_cn as text;
use std::{path::PathBuf, sync::atomic::AtomicBool};

pub(super) trait Adapter: Sync {
    fn metadata(&self) -> Mode;
    fn plan(&self, config: &Config) -> Result<Plan, String>;
    fn read(
        &self,
        config: &Config,
        paths: &[PathBuf],
        cancel: &AtomicBool,
    ) -> Result<Vec<String>, String>;
}

struct Native;
struct Python;
struct Command;
pub(super) static ADAPTERS: &[&dyn Adapter] = &[&Native, &Python, &Command];

fn field(key: &str, label: &str, kind: &str, required: bool) -> Field {
    Field {
        key: key.into(),
        label: label.into(),
        kind: kind.into(),
        required,
    }
}
fn mode(id: &str, name: &str, fields: Vec<Field>) -> Mode {
    Mode {
        id: id.into(),
        name: name.into(),
        fields,
        self_check: text::TEXT_READ_CHECK_DESCRIPTION.into(),
    }
}
impl Adapter for Native {
    fn metadata(&self) -> Mode {
        mode("native", text::TEXT_READ_NATIVE, vec![])
    }
    fn plan(&self, _: &Config) -> Result<Plan, String> {
        Ok(Plan {
            executable: None,
            arguments: vec![],
        })
    }
    fn read(
        &self,
        _: &Config,
        paths: &[PathBuf],
        cancel: &AtomicBool,
    ) -> Result<Vec<String>, String> {
        paths
            .iter()
            .map(|path| {
                super::check_cancel(cancel)?;
                std::fs::read_to_string(path).map_err(super::error)
            })
            .collect()
    }
}
impl Adapter for Python {
    fn metadata(&self) -> Mode {
        mode(
            "python",
            text::TEXT_READ_PYTHON,
            vec![field(
                "executable",
                text::TEXT_READ_INTERPRETER,
                "string",
                true,
            )],
        )
    }
    fn plan(&self, config: &Config) -> Result<Plan, String> {
        Ok(Plan {
            executable: Some(super::process::resolve(&config.values["executable"])?),
            arguments: vec![
                "-I".into(),
                "-X".into(),
                "utf8".into(),
                "-c".into(),
                PYTHON.into(),
            ],
        })
    }
    fn read(
        &self,
        config: &Config,
        paths: &[PathBuf],
        cancel: &AtomicBool,
    ) -> Result<Vec<String>, String> {
        super::process::run(&self.plan(config)?, config.timeout_ms, paths, cancel)
    }
}
impl Adapter for Command {
    fn metadata(&self) -> Mode {
        mode(
            "command",
            text::TEXT_READ_COMMAND,
            vec![
                field("executable", text::TEXT_READ_EXECUTABLE, "string", true),
                field("arguments", text::TEXT_READ_ARGUMENTS, "stringArray", true),
            ],
        )
    }
    fn plan(&self, config: &Config) -> Result<Plan, String> {
        Ok(Plan {
            executable: Some(super::process::resolve(&config.values["executable"])?),
            arguments: serde_json::from_str(&config.values["arguments"]).map_err(super::error)?,
        })
    }
    fn read(
        &self,
        config: &Config,
        paths: &[PathBuf],
        cancel: &AtomicBool,
    ) -> Result<Vec<String>, String> {
        super::process::run(&self.plan(config)?, config.timeout_ms, paths, cancel)
    }
}
const PYTHON: &str = "import json,sys\nr=json.load(sys.stdin)\nout=[]\nfor p in r['paths']:\n with open(p,'rb') as f:\n  b=f.read(67108865)\n if len(b)>67108864: raise ValueError('file too large')\n out.append(b.decode('utf-8'))\nsys.stdout.buffer.write(json.dumps(out,ensure_ascii=False).encode('utf-8'))";
