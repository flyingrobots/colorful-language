use zed_extension_api::{
    self as zed, settings::LspSettings, Command, LanguageServerId, Result, Worktree,
};

const SERVER_ID: &str = "colorful-lsp";

struct ColorfulExtension;

impl zed::Extension for ColorfulExtension {
    fn new() -> Self {
        ColorfulExtension
    }

    fn language_server_command(
        &mut self,
        _language_server_id: &LanguageServerId,
        worktree: &Worktree,
    ) -> Result<Command> {
        if let Some(command) = configured_language_server_command(worktree)? {
            return Ok(command);
        }

        // Resolve colorful-lsp from PATH; install it with `cargo install colorful-lsp`.
        let path = worktree.which(SERVER_ID).ok_or_else(|| {
            format!(
                "{SERVER_ID} not found on PATH — install it with `cargo install {SERVER_ID}` \
                 or set lsp.{SERVER_ID}.binary.path in Zed settings"
            )
        })?;
        Ok(Command {
            command: path,
            args: Vec::new(),
            env: Vec::new(),
        })
    }
}

fn configured_language_server_command(worktree: &Worktree) -> Result<Option<Command>> {
    let settings = LspSettings::for_worktree(SERVER_ID, worktree)?;
    let Some(binary) = settings.binary else {
        return Ok(None);
    };
    let Some(path) = binary.path.filter(|path| !path.trim().is_empty()) else {
        return Ok(None);
    };

    Ok(Some(Command {
        command: path,
        args: binary.arguments.unwrap_or_default(),
        env: binary.env.unwrap_or_default().into_iter().collect(),
    }))
}

zed::register_extension!(ColorfulExtension);
