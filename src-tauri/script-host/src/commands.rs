use crate::protocol::{Failure, Result, Snapshot};
use serde_json::{json, Value};
use std::collections::BTreeMap;

pub struct Context {
    pub snapshot: Snapshot,
    pub results: BTreeMap<String, Value>,
    pub failures: Vec<Failure>,
}
pub struct Command {
    pub name: &'static str,
    pub parameters: &'static str,
    pub returns: &'static str,
    pub errors: &'static str,
    pub section: &'static str,
    pub run: CommandHandler,
}
type CommandHandler = fn(&mut Context, Value, &mut dyn FnMut(Value) -> Result<()>) -> Result<Value>;
pub const COMMANDS: &[Command] = &[
    Command {
        name: "images",
        parameters: "{}",
        returns: "[{path,name}]",
        errors: "INVALID_ARGUMENT",
        section: "images",
        run: images,
    },
    Command {
        name: "label",
        parameters: "{name} | {id}",
        returns: "LabelConfig",
        errors: "LABEL_NOT_FOUND,LABEL_AMBIGUOUS,INVALID_ARGUMENT",
        section: "labels",
        run: label,
    },
    Command {
        name: "annotations",
        parameters: "{imagePath}",
        returns: "AnnotationShape[]",
        errors: "IMAGE_NOT_FOUND,INVALID_ARGUMENT",
        section: "images",
        run: annotations,
    },
    Command {
        name: "submit",
        parameters: "{imagePath,annotations}",
        returns: "true",
        errors: "IMAGE_NOT_FOUND,INVALID_ARGUMENT,INVALID_ANNOTATION",
        section: "images",
        run: submit,
    },
    Command {
        name: "size",
        parameters: "{imagePath}",
        returns: "{width,height}",
        errors: "DIMENSIONS_UNAVAILABLE,IMAGE_NOT_FOUND",
        section: "images",
        run: size,
    },
    Command {
        name: "progress",
        parameters: "{completed,total}",
        returns: "true",
        errors: "INVALID_ARGUMENT",
        section: "",
        run: progress,
    },
    Command {
        name: "log",
        parameters: "{message}",
        returns: "true",
        errors: "INVALID_ARGUMENT",
        section: "",
        run: log,
    },
];
impl Context {
    pub fn new(snapshot: Snapshot) -> Self {
        Self {
            snapshot,
            results: BTreeMap::new(),
            failures: vec![],
        }
    }
    pub fn call(
        &mut self,
        name: &str,
        args: Value,
        emit: &mut dyn FnMut(Value) -> Result<()>,
    ) -> Result<Value> {
        let result = COMMANDS
            .iter()
            .find(|c| c.name == name)
            .ok_or_else(|| Failure::new("METHOD_NOT_FOUND", name))
            .and_then(|command| {
                if args.is_object() {
                    (command.run)(self, args.clone(), emit)
                } else {
                    Err(Failure::new("INVALID_ARGUMENT", name))
                }
            });
        if let Err(error) = &result {
            let mut error = error.clone();
            error.image_path = args["imagePath"].as_str().map(str::to_owned);
            self.failures.push(error);
        }
        result
    }
    fn image(&self, args: &Value) -> Result<&Value> {
        let path = args["imagePath"]
            .as_str()
            .ok_or_else(|| Failure::new("INVALID_ARGUMENT", "imagePath"))?;
        self.snapshot
            .images
            .iter()
            .find(|image| image["path"] == path)
            .ok_or_else(|| Failure::new("IMAGE_NOT_FOUND", path))
    }
}
fn images(
    context: &mut Context,
    _: Value,
    _: &mut dyn FnMut(Value) -> Result<()>,
) -> Result<Value> {
    Ok(Value::Array(
        context
            .snapshot
            .images
            .iter()
            .map(|i| json!({"path":i["path"], "name":i["name"]}))
            .collect(),
    ))
}
fn label(
    context: &mut Context,
    args: Value,
    _: &mut dyn FnMut(Value) -> Result<()>,
) -> Result<Value> {
    let key = match (args["name"].as_str(), args["id"].as_str()) {
        (Some(_), None) => "name",
        (None, Some(_)) => "id",
        _ => return Err(Failure::new("INVALID_ARGUMENT", "label")),
    };
    let mut matches = context
        .snapshot
        .labels
        .iter()
        .filter(|l| l[key] == args[key]);
    let found = matches
        .next()
        .ok_or_else(|| Failure::new("LABEL_NOT_FOUND", &args[key]))?;
    if matches.next().is_some() {
        return Err(Failure::new("LABEL_AMBIGUOUS", &args[key]));
    }
    Ok(found.clone())
}
fn annotations(
    context: &mut Context,
    args: Value,
    _: &mut dyn FnMut(Value) -> Result<()>,
) -> Result<Value> {
    Ok(context.image(&args)?["annotations"].clone())
}
fn submit(
    context: &mut Context,
    args: Value,
    _: &mut dyn FnMut(Value) -> Result<()>,
) -> Result<Value> {
    let path = context.image(&args)?["path"]
        .as_str()
        .ok_or_else(|| Failure::new("INVALID_ARGUMENT", "path"))?
        .to_owned();
    if !args["annotations"].is_array() {
        return Err(Failure::new("INVALID_ARGUMENT", "annotations"));
    }
    // Core annotation validation is authoritative at the frontend transaction boundary,
    // shared with native imports and manual writes. Do not duplicate those rules here.
    context.results.insert(path, args["annotations"].clone());
    Ok(json!(true))
}
fn size(
    context: &mut Context,
    args: Value,
    _: &mut dyn FnMut(Value) -> Result<()>,
) -> Result<Value> {
    let size = &context.image(&args)?["size"];
    if size.is_null() {
        return Err(Failure::new("DIMENSIONS_UNAVAILABLE", "size"));
    }
    Ok(size.clone())
}
fn progress(
    _: &mut Context,
    args: Value,
    emit: &mut dyn FnMut(Value) -> Result<()>,
) -> Result<Value> {
    let completed = args["completed"]
        .as_u64()
        .ok_or_else(|| Failure::new("INVALID_ARGUMENT", "completed"))?;
    let total = args["total"]
        .as_u64()
        .filter(|t| *t > 0 && *t >= completed)
        .ok_or_else(|| Failure::new("INVALID_ARGUMENT", "total"))?;
    emit(json!({"event":"progress", "completed":completed, "total":total}))?;
    Ok(json!(true))
}
fn log(_: &mut Context, args: Value, emit: &mut dyn FnMut(Value) -> Result<()>) -> Result<Value> {
    let message = args["message"]
        .as_str()
        .ok_or_else(|| Failure::new("INVALID_ARGUMENT", "message"))?;
    emit(json!({"event":"log", "message":message}))?;
    Ok(json!(true))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn commands_report_errors_and_tolerate_extensions() {
        let mut ctx = Context::new(Snapshot {
            labels: vec![
                json!({"id":"a","name":"car"}),
                json!({"id":"b","name":"car"}),
            ],
            images: vec![json!({"path":"a.png","name":"a.png","annotations":[]})],
        });
        let mut emit = |_| Ok(());
        for (name, args, code) in [
            ("unknown", json!({}), "METHOD_NOT_FOUND"),
            ("label", json!({"name":"car"}), "LABEL_AMBIGUOUS"),
            ("label", json!({"name":"missing"}), "LABEL_NOT_FOUND"),
            ("annotations", json!({}), "INVALID_ARGUMENT"),
            (
                "size",
                json!({"imagePath":"a.png"}),
                "DIMENSIONS_UNAVAILABLE",
            ),
        ] {
            assert_eq!(ctx.call(name, args, &mut emit).unwrap_err().code, code);
        }
        assert_eq!(
            ctx.call(
                "annotations",
                json!({"imagePath":"a.png","future":true}),
                &mut emit
            )
            .unwrap(),
            json!([])
        );
    }
}
