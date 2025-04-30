# Demo Mercado Pago MCP Server

A Model Context Protocol server that provides tools for integrating Mercado Pago into your applications.


## Installation & Setup

1. Clone the repository:
    ```bash
    git clone https://github.com/mercadolibre/demo-mercadopago-mcp-server.git
    cd demo-mercadopago-mcp-server
    ```

2. Install dependencies:
    ```bash
    npm install
    ```

3. Get Mercado Pago API credentials

    You'll need to provide valid Mercado Pago API credentials through the environment variables:
    - Get your credentials from [Mercado Pago Developer Dashboard](https://www.mercadopago.com/developers/panel/credentials)
    - CLIENT_ID: Your Mercado Pago application ID
    - CLIENT_SECRET: Your Mercado Pago secret key

4. Configure MCP Server in your IDE

    To use with Claude Desktop or other MCP-compatible applications (including Windsurf, Cursor, Cline, etc), add the server configuration to your settings:

    ```json
    {
      "mcpServers": {
        "mercadopago": {
          "command": "node",
          "args": ["/path/to/demo-mercadopago-mcp-server/build/index.js"],
          "env": {
            "CLIENT_ID": "your-mercadopago-client-id",
            "CLIENT_SECRET": "your-mercadopago-client-secret",
            "DEBUG": "true"  // Optional: Enable debug logging
          }
        }
      }
    }
    ```

## Available Tools


### search_documentation
Search through Mercado Pago's documentation.

#### Parameters
- `language` (string, required)
  - Documentation language
  - Options: "es" (Spanish), "pt" (Portuguese)

- `query` (string, required)
  - Search term to find in documentation

- `siteId` (string, required)
  - Country site identifier
  - Options: "MLB" (Brazil), "MLA" (Argentina), "MLM" (Mexico), "MLU" (Uruguay), "MLC" (Chile), "MCO" (Colombia), "MPE" (Peru)

- `limit` (number, optional)
  - Maximum number of results to return
  - Default: 10
  - Range: 1-100

#### Example Request
```xml
<use_mcp_tool>
<server_name>mercadopago</server_name>
<tool_name>search_documentation</tool_name>
<arguments>
{
  "language": "es",
  "query": "checkout pro",
  "siteId": "MLA",
  "limit": 3
}
</arguments>
</use_mcp_tool>
```

#### Example response:
```markdown
# Search Results for "checkout pro"
Showing 3 of 8 results

## Checkout Pro
Checkout Pro es una solución que permite a tus clientes realizar pagos de forma segura...

🔗 [Read more](https://www.mercadopago.com.ar/developers/es/guides/checkout-pro/introduction)

Score: 0.95

---

## Integrar Checkout Pro
Aprende a integrar Checkout Pro en tu sitio web para comenzar a recibir pagos...

🔗 [Read more](https://www.mercadopago.com.ar/developers/es/guides/checkout-pro/integration)

Score: 0.85
```

## Development Guide

### Building

Install dependencies:
```bash
npm install
```

Build the server:
```bash
npm run build
```

Watch mode for development:
```bash
npm run watch
```

### Running

Configure environment variables:
```bash
export CLIENT_ID=your_mercadopago_client_id
export CLIENT_SECRET=your_mercadopago_client_secret
export DEBUG=true  # Optional: Enable debug logging
```

Start the server:
```bash
npm start
```

Run with inspector for testing:
```bash
npm run inspector
```
