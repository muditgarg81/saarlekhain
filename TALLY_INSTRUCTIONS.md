# Tally Prime Integration & Connectivity Guide

This guide explains how to connect your local **Tally Prime** client/server to the **Saarlekha Stores & Purchase** cloud platform using the standalone **LAN Bridge Agent**.

---

## Architecture Overview

```
 ┌────────────────────────┐              ┌────────────────────────┐
 │      Tally Prime       │  HTTP / XML   │    LAN Bridge Agent    │
 │  (Local Port: 9000)    │ ◄───────────► │  (Runs on local network)│
 └────────────────────────┘              └───────────┬────────────┘
                                                     │
                                                     │ Outbound HTTPs
                                                     ▼
                                         ┌────────────────────────┐
                                         │    Saarlekha Cloud     │
                                         │  (saarlekhain.com)     │
                                         └────────────────────────┘
```

The **LAN Bridge Agent** runs inside your factory or accounting network. It polls Tally Prime locally (via port 9000 XML server) and communicates outbound to Saarlekha Cloud over standard HTTPS. 
*No inbound port forwarding or firewall exceptions are needed on your local router.*

---

## Setup Instructions

### Step 1: Register a LAN Bridge Agent in Saarlekha
1. Navigate to the **ERP & Tally Settings** page on the Saarlekha platform.
2. Scroll to the **LAN Bridge Agents** panel at the bottom.
3. In the **Agent location name** field, type a name identifying the machine where the agent will run (e.g. `Office Accounting Server` or `Accounts PC`).
4. Click **Add**.
5. Copy the generated **Bridge Token** (e.g., `agent_clpx82j...`). *Keep this token secure.*

---

### Step 2: Enable HTTP Connectivity in Tally Prime
Configure Tally Prime to listen for XML/HTTP queries:
1. Open Tally Prime.
2. Click **F1: Help** (top right) > **Settings** > **Connectivity**.
3. Set the following parameters:
   - **TallyPrime acts as**: `Both` (or `Server`)
   - **Enable HTTP server**: `Yes`
   - **Port**: `9000` (ensure this matches the port configuration of the bridge agent)
4. Save the settings and restart Tally Prime.
5. Open the company you want to sync (e.g., `CROX FY 2024-25`).

---

### Step 3: Run the Bridge Agent Locally
Run the bridge agent on the machine that has access to both **Tally Prime** (port 9000) and the **Internet**:

1. Ensure **Node.js** (v16+) is installed on that machine.
2. Download or locate the bridge agent script: `bin/bridge-agent.js`.
3. Open a command prompt or terminal in the folder containing `bridge-agent.js` and execute:
   ```bash
   node bridge-agent.js https://saarlekhain.com YOUR_BRIDGE_TOKEN
   ```
   *(Replace `YOUR_BRIDGE_TOKEN` with the unique token generated in **Step 1**).*

Upon starting, the agent will verify connectivity:
* It checks if Tally Prime is active on `http://localhost:9000`.
* It opens a connection to the Saarlekha Cloud server to receive sync instructions.

---

### Step 4: Map Ledger Accounts
To link your Saarlekha Vendors with Tally accounts:
1. Go back to the **ERP & Tally Settings** page in Saarlekha.
2. Under the **Ledger Account Mappings** tab:
   - Select a **Saarlekha Vendor** from the dropdown.
   - Type the exact **Tally Ledger Account Name** as it is spelled in Tally Prime.
3. Click **Add Mapping**.

Synced balances, bills, and writebacks will now execute automatically when the agent is online.

---

## Troubleshooting

### 1. Tally Offline Error
If the bridge agent prints `Tally offline (port 9000). Fallback to simulation mode.`:
- Double-check that Tally Prime is open and running on the same machine.
- Verify that **F1: Help > Settings > Connectivity** has the HTTP server enabled and the port is set to `9000`.
- Verify no other local software (like another web server) is blocking port `9000`.

### 2. Firewall / Antivirus Blocks
If the agent cannot talk to Tally Prime:
- Ensure your local Windows Firewall or Antivirus is not blocking incoming HTTP connections on port `9000`. You can add an inbound rule allowing TCP port `9000`.
