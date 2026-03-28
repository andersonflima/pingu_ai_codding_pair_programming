use zed_extension_api as zed;

struct RealtimeDevAgentExtension;

impl zed::Extension for RealtimeDevAgentExtension {
    fn new() -> Self {
        Self
    }

    fn language_server_command(
        &mut self,
        _language_server_id: &zed::LanguageServerId,
        _worktree: &zed::Worktree,
    ) -> zed::Result<zed::Command> {
        Ok(
            zed::Command::new(zed::node_binary_path()?)
                .arg("server/realtime_dev_agent_lsp.js"),
        )
    }
}

zed::register_extension!(RealtimeDevAgentExtension);
