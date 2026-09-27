# LAND-GPT

LAND-GPT is a Land Stack interoperability platform connecting fragmented land-record systems through a common data model, ULPIN-based parcel identity, GIS, validation, and state-specific workflows.

## Features

- Parcel-level GIS and cadastral visualization
- Maharashtra, Uttar Pradesh and Gujarat integration
- ULPIN-based parcel registry
- Land records, registration, mutation, planning, tax and utility data
- Cross-source verification and data-quality checks
- Citizen land information portal
- State-specific government workflows
- Mutation and verification reports
- English, Hindi, Marathi and Gujarati support
- Optional AI-assisted parcel analysis

## Architecture

```text
Citizen / Government Portal
          |
       API Layer
          |
   Canonical Land Model
          |
    State Adapters
      /    |    \
    MH     UP    GJ
```

LAND-GPT federates existing state systems rather than replacing them, allowing each state to retain its own data structures and workflows while providing a common interoperability layer.

## Run Locally

### 1. Clone the repository

```bash
git clone https://github.com/siddhi-works/LAND-GPT.git
cd LAND-GPT
```

### 2. Create a virtual environment

Windows:

```cmd
python -m venv .venv
```

### 3. Activate the virtual environment

```cmd
.venv\Scripts\activate
```

### 4. Install dependencies

```cmd
pip install -r backend/requirements.txt
```

### 5. Start the application

```cmd
python -m uvicorn interop.api.app:create_app --factory --app-dir backend
```

### 6. Open in browser

```text
http://127.0.0.1:8000
```

Keep the terminal running while using the application.

## AI Assistant

The AI assistant is optional and requires an Anthropic API key.

Windows CMD:

```cmd
set ANTHROPIC_API_KEY=your_api_key
```

An optional model can also be configured:

```cmd
set LANDSTACK_ASSISTANT_MODEL=claude-opus-5
```

The assistant uses the selected parcel's available records and validation findings as context.

## Project Structure

```text
LAND-GPT/
├── backend/
│   ├── interop/
│   ├── requirements.txt
│   └── ...
├── landstack/
│   ├── maharashtra/
│   ├── uttar_pradesh/
│   └── gujarat/
├── frontend/
└── README.md
```

## States

The current implementation includes:

- Maharashtra
- Uttar Pradesh
- Gujarat

Supported interface languages:

- English
- Hindi
- Marathi
- Gujarati

## Demo Environment

Data shown is replicated government-system data for demonstration purposes.
