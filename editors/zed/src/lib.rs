use zed_extension_api::{self as zed, Command, LanguageServerId, Result, Worktree};

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
        // Resolve colorful-lsp from PATH; install it with `cargo install colorful-lsp`.
        let path = worktree.which("colorful-lsp").ok_or_else(|| {
            "colorful-lsp not found on PATH — install it with `cargo install colorful-lsp`"
                .to_string()
        })?;
        Ok(Command {
            command: path,
            args: Vec::new(),
            env: Vec::new(),
        })
    }
}

zed::register_extension!(ColorfulExtension);
