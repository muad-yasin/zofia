use std::process::Command;

fn main() {
    // PLAN.md §5: src/generated/providers.rs is generated from config/providers.json by the
    // same script that writes the TS copy, so the two id lists can't drift. It's gitignored,
    // so a fresh clone gets it here.
    for f in ["../config/providers.json", "../config/providers.schema.json", "../scripts/gen-providers.mjs"] {
        println!("cargo:rerun-if-changed={f}");
    }
    match Command::new("node").arg("../scripts/gen-providers.mjs").status() {
        Ok(s) if s.success() => {}
        Ok(s) => panic!(
            "scripts/gen-providers.mjs failed ({s}); config/providers.json is invalid, see the errors above. \
             src/generated/providers.rs was not (re)written."
        ),
        Err(e) => panic!(
            "could not run `node` ({e}). Building Zofia's Rust side needs Node.js on PATH: build.rs runs \
             scripts/gen-providers.mjs to generate the gitignored src-tauri/src/generated/providers.rs. \
             Install Node, or run `npm run gen:providers` once from a machine that has it."
        ),
    }
    tauri_build::build()
}
