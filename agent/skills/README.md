# Workflow Skills

A "workflow skill" is a reusable instruction package that tells the AI agent how to perform a specific part of the daily workflow. Skills are composable — you can run them individually or chain them together.

---

## What is a Skill?

A skill is a set of instructions (a prompt) that:

1. Defines the agent's goal for that step.
2. Specifies what context the agent should read first.
3. Describes what output the agent should produce.
4. Includes security constraints to prevent unsafe behaviour.

Skills are stored as Markdown files in `agent/prompts/`. They are designed to be provider-neutral — you can use them with ChatGPT, Claude, Codex, or any other language model.

---

## Available Skills

| Skill | Prompt file | Description |
|-------|-------------|-------------|
| Daily summary | `agent/prompts/daily_summary.md` | Summarise the day's work context into a structured overview |
| Task extraction | `agent/prompts/task_extraction.md` | Extract actionable tasks from messages, emails, and documents |
| Workflow update | `agent/prompts/workflow_update.md` | Update workflow state based on completed and outstanding actions |
| Security rules | `agent/prompts/security_rules.md` | Mandatory security constraints (include in all agent instructions) |

---

## How to Use Skills

### Option 1: ChatGPT Custom GPT System Prompt

Copy the content of one or more skill files into the ChatGPT Custom GPT system prompt. Always include `security_rules.md`.

### Option 2: API call with system message

```python
import anthropic  # or openai

with open("agent/prompts/security_rules.md") as f:
    security_rules = f.read()

with open("agent/prompts/daily_summary.md") as f:
    skill_instructions = f.read()

system_prompt = f"{security_rules}\n\n{skill_instructions}"

# Then call your preferred AI API with system_prompt
```

### Option 3: Include in agent configuration file

If your agent runtime supports configuration files, reference the prompt files directly.

---

## Creating a New Skill

1. Create a new Markdown file in `agent/prompts/`.
2. Structure it with these sections:
   - **Goal** — what the agent should accomplish
   - **Context to read** — what the agent should fetch before acting
   - **Expected output** — the JSON structure the agent should produce
   - **Constraints** — safety and quality rules for this skill
3. Test it with a sample payload from `agent/examples/`.
4. Submit a PR with the new skill file.

---

## Security Requirements for All Skills

Every skill must include or reference `agent/prompts/security_rules.md`. The core rules:

- Never include `user_id`, `token`, `password`, `secret`, or credential fields in any output.
- User identity is resolved server-side — never trust or include a `user_id` in the agent payload.
- Do not auto-send emails, Slack messages, or Jira comments without explicit user approval.
- Do not store raw email bodies, Slack messages, or Jira content unless the user explicitly requested it.
- Prefer summaries and references over raw sensitive content.

---

## Example Skill Invocation Sequence

A typical morning workflow uses these skills in sequence:

```
1. security_rules.md  (always first)
2. daily_summary.md   (generate today's summary)
3. task_extraction.md (extract tasks from the summary and external context)
4. workflow_update.md (update carry-over tasks from yesterday)
```
