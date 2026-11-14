Project: <Project name> (<ABBR>)
Document: Functional Technical Specification Document
Document Name: [FTSD] <ABBR>.docx
Version: 0.01
Status: draft
Owner: <analyst>
Based-on: blueprint@<gate B hash>

**Document History**

| Version | Author | Detail of Changes | Effective Date |
|---|---|---|---|
| 0.01 | <analyst> | Initial draft from Blueprint + design | |

# High-level Business Process

| Current Practice | Expected Change | Expected Benefit |
|---|---|---|
| | | |

# Role & Authorization

Role & Responsibility, Role Authorization and Process Approval matrices: see Blueprint §Role & Responsibility (single source, not copied).

| ID | Authorization Rule |
|---|---|
| AR-01 | |

# User Story & Design

## SCR-01 <Screen name>

| Item | Detail |
|---|---|
| User story | US-01 |
| Path | Login → <menu> → <screen> |
| Persona role | |
| Pre-requisite step | |
| Wireflow link | |
| Mockup link | <Figma node> |

| ID | Rule and validation |
|---|---|
| BR-01 | |

| No | Field | Description | Sample | Type (Length) | M/O/C | Editable | Default | Source | Logic / Validation | Error message |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | | | | Text (50) | M | Y | | SRC-01 | BR-01 | |

| ID | Scenario | Input | Expected |
|---|---|---|---|
| TC-01 | | | |

# Notification

| No | Rule |
|---|---|
| 1 | |

# Analytics

| Metric | Definition | Source |
|---|---|---|
| | | |

# Dependencies

- <system / team / data>

# Technical

## ERD and Data Source Catalog

| ID | System | View / Table | Key | Refresh |
|---|---|---|---|---|
| SRC-01 | SAP | | | |

## API Contract

Detail: `openapi.yaml` (source of truth for request, response and errors).

| ID | Method | Path | SCR / US | Auth | Request | Response | Errors |
|---|---|---|---|---|---|---|---|
| API-01 | GET | /<resource> | SCR-01 / US-01 | AR-01 | | 200 | 403 AR-01 |

## Integration

| System | Direction | Schedule | Failure handling |
|---|---|---|---|
| SAP | SAP → Bspace | | |

# Approval

**Functional Approval**

| Team | Role | Name | Signature | Date |
|---|---|---|---|---|
| Product Team | Analyst | | | |
| Business | User representative | | | |

**Technical Approval**

| Team | Role | Name | Signature | Date |
|---|---|---|---|---|
| Engineering | Backend Lead | | | |
| Engineering | Frontend Lead | | | |
