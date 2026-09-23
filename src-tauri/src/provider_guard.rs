//! PLAN.md §5 runtime model rejection (HANDOFF item 7). The build-time schema only stops
//! a grok/xAI id declared in config/providers.json; this check stops one arriving at
//! runtime, whether typed by hand or reached through an alias. It deliberately does not
//! consult the schema, so it still fires if the schema check is bypassed or broken.
//! Call `check_model` before any model id reaches a spawned `claude --model`.

#[allow(dead_code)]
mod generated {
    // Written by scripts/gen-providers.mjs (build.rs runs it); gitignored.
    include!("generated/providers.rs");
}

pub use generated::{DEFAULT_MODEL, MODEL_IDS};

#[derive(Debug, PartialEq, Eq)]
pub enum ModelRejection {
    Empty,
    NonAscii(String),
    Forbidden { input: String, resolved: String },
}

impl std::fmt::Display for ModelRejection {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Empty => write!(f, "empty model id"),
            Self::NonAscii(s) => write!(f, "model id {s:?} has non-ASCII characters"),
            Self::Forbidden { input, resolved } if input == resolved => {
                write!(f, "model {input:?} is an xAI/Grok model, which Zofia never runs")
            }
            Self::Forbidden { input, resolved } => write!(
                f,
                "alias {input:?} resolves to {resolved:?}, an xAI/Grok model, which Zofia never runs"
            ),
        }
    }
}

/// Same rule as the schema's `notForbidden`, written independently: any "grok", or an
/// "xai"/"x-ai" segment at the start of the id or after a '/' or ':'.
pub fn is_forbidden(id: &str) -> bool {
    let l = id.to_ascii_lowercase();
    if l.contains("grok") {
        return true;
    }
    let b = l.as_bytes();
    (0..b.len()).any(|i| {
        let at_boundary = i == 0 || b[i - 1] == b'/' || b[i - 1] == b':';
        at_boundary
            && ["xai", "x-ai"].iter().any(|p| {
                b[i..].starts_with(p.as_bytes())
                    && matches!(b.get(i + p.len()), None | Some(b'/' | b':' | b'_' | b'.' | b'-'))
            })
    })
}

/// Resolves `input` through `aliases` and rejects it if either the typed id or its
/// target is forbidden. Ids not in the config are allowed through (the CLI accepts full
/// model ids); only the xAI/Grok rule is enforced here.
pub fn check_model_with(input: &str, aliases: &[(&str, &str)]) -> Result<String, ModelRejection> {
    let id = input.trim();
    if id.is_empty() {
        return Err(ModelRejection::Empty);
    }
    // Lookalike letters (e.g. Cyrillic 'о' in "grоk") would slip past an ASCII match.
    if !id.is_ascii() {
        return Err(ModelRejection::NonAscii(id.to_string()));
    }
    let resolved = aliases
        .iter()
        .find(|(a, _)| *a == id)
        .map_or(id, |(_, target)| *target);
    if is_forbidden(id) || is_forbidden(resolved) {
        return Err(ModelRejection::Forbidden { input: id.to_string(), resolved: resolved.to_string() });
    }
    Ok(resolved.to_string())
}

/// `check_model_with` against the aliases generated from config/providers.json.
pub fn check_model(input: &str) -> Result<String, ModelRejection> {
    check_model_with(input, generated::ALIASES)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn configured_models_pass() {
        for id in MODEL_IDS {
            assert_eq!(check_model(id).as_deref(), Ok(*id));
        }
        assert!(MODEL_IDS.contains(&DEFAULT_MODEL));
    }

    #[test]
    fn typed_grok_and_xai_ids_are_rejected() {
        for id in [
            "grok-5", "GROK", "x-ai/grok-4.1-fast", "openrouter/x-ai/some-model", "xai",
            "XAI:model", "xai-large", " grok ", "provider:x-ai",
        ] {
            assert!(
                matches!(check_model(id), Err(ModelRejection::Forbidden { .. })),
                "{id} should be rejected"
            );
        }
    }

    #[test]
    fn lookalike_characters_are_rejected() {
        assert_eq!(check_model("gr\u{043e}k").unwrap_err(), ModelRejection::NonAscii("gr\u{043e}k".into()));
    }

    #[test]
    fn alias_to_grok_is_rejected() {
        let aliases = [("fast", "x-ai/grok-5"), ("main", "sonnet")];
        let err = check_model_with("fast", &aliases).unwrap_err();
        assert_eq!(err, ModelRejection::Forbidden { input: "fast".into(), resolved: "x-ai/grok-5".into() });
        assert!(err.to_string().contains("alias \"fast\""));
        assert_eq!(check_model_with("main", &aliases).as_deref(), Ok("sonnet"));
    }

    #[test]
    fn near_misses_are_allowed() {
        // "xai" only counts as a whole leading segment; these are not xAI models.
        for id in ["claude-sonnet-5", "maxai-model", "taxai", "anthropic/claude-opus-5-5"] {
            assert!(check_model(id).is_ok(), "{id} should pass");
        }
        assert_eq!(check_model("   "), Err(ModelRejection::Empty));
    }
}
