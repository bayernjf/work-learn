-- Date: 2026-08-17
alter table public.sessions
  drop constraint sessions_source_check,
  add constraint sessions_source_check check (source in ('claude', 'chatgpt', 'hermes', 'openclaw', 'opencode', 'codex', 'pi', 'terminal', 'manual'));

alter table public.learning_materials
  drop constraint learning_materials_source_check,
  add constraint learning_materials_source_check check (source in ('claude', 'chatgpt', 'hermes', 'openclaw', 'opencode', 'codex', 'pi', 'terminal', 'manual'));
