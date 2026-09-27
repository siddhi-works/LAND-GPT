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
