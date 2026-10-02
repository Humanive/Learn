# Triage labels

The `/triage` skill applies these labels to represent the five canonical triage states.

| Role | Label string |
|------|--------------|
| `needs-triage` | `needs-triage` |
| `needs-info` | `needs-info` |
| `ready-for-agent` | `ready-for-agent` |
| `ready-for-human` | `ready-for-human` |
| `wontfix` | `wontfix` |

When triaging, the skill reads this table, applies the label that matches the chosen role, and removes any other labels from the table that are present on the issue.
