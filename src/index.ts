#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';

// Extend AxiosConfig to include retry flag
declare module 'axios' {
  export interface InternalAxiosRequestConfig {
    __isRetry?: boolean;
  }
}

// Simple logger class
class Logger {
  log(level: 'info' | 'error' | 'debug', message: string, context?: any) {
    const timestamp = new Date().toISOString();
    const contextStr = context ? `\n${JSON.stringify(context, null, 2)}` : '';
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}${contextStr}\n`;
    process.stderr.write(logMessage);
  }

  info(message: string, context?: any) {
    this.log('info', message, context);
  }

  error(message: string, context?: any) {
    this.log('error', message, context);
  }

  debug(message: string, context?: any) {
    if (process.env.DEBUG) {
      this.log('debug', message, context);
    }
  }
}

// Initialize global logger
const logger = new Logger();

// Environment variables
if (!process.env.CLIENT_ID || !process.env.CLIENT_SECRET) {
  logger.error('Missing required environment variables', {
    CLIENT_ID: !!process.env.CLIENT_ID,
    CLIENT_SECRET: !!process.env.CLIENT_SECRET
  });
  process.exit(1);
}

// Interfaces
interface AuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

type SiteId = 'MLA' | 'MLB' | 'MLM' | 'MLU' | 'MLC' | 'MCO' | 'MPE';

type Language = 'es' | 'pt';

interface SearchResult {
  title: string;
  content: string;
  url: string;
  score?: number;
}

interface SearchDocumentationArgs {
  language: Language;  // maps to lang
  query: string;      // maps to term
  siteId: SiteId;     // Required parameter
  limit?: number;     // maps to maxResults
}

interface RequestContext {
  toolName: string;
  requestId: string;
  startTime: number;
}

// Auth service
class AuthService {
  private accessToken: string | null = null;
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  async getAccessToken(): Promise<string> {
    if (this.accessToken) return this.accessToken;

    try {
      this.logger.debug('Requesting OAuth token');
      const response = await axios.post<AuthResponse>(
        'https://api.mercadolibre.com/oauth/token',
        {
          grant_type: 'client_credentials',
          client_id: process.env.CLIENT_ID,
          client_secret: process.env.CLIENT_SECRET
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          }
        }
      );

      this.accessToken = response.data.access_token;
      this.logger.debug('OAuth token obtained', { expires_in: response.data.expires_in });
      return this.accessToken;
    } catch (error) {
      this.logger.error('Failed to obtain OAuth token', { error });
      if (error instanceof Error) {
        throw new McpError(
          ErrorCode.InternalError,
          `MercadoPago Auth error: ${error.message}`
        );
      }
      throw error;
    }
  }

  clearToken() {
    this.accessToken = null;
  }
}

// Main server class
class DemoMercadoPagoServer {
  private server: Server;
  private api: AxiosInstance;
  private logger: Logger;
  private authService: AuthService;
  private requestCount: number = 0;

  private buildDocumentationUrl(siteDomain: string, language: Language, path: string): string {
    if (!siteDomain || !language) {
      throw new McpError(ErrorCode.InvalidParams, 'Missing required parameters for URL construction');
    }
    return `https://${siteDomain}/developers/${language}${path || ''}`;
  }

  private static readonly VALID_SITES: readonly SiteId[] = [
    'MLA', 'MLB', 'MLM', 'MLU', 'MLC', 'MCO', 'MPE'
  ] as const;

  private static readonly SITE_DOMAINS: Record<SiteId, string> = {
    MLA: "www.mercadopago.com.ar",
    MLB: "www.mercadopago.com.br",
    MLM: "www.mercadopago.com.mx",
    MLU: "www.mercadopago.com.uy",
    MLC: "www.mercadopago.cl",
    MCO: "www.mercadopago.com.co",
    MPE: "www.mercadopago.com.pe"
  } as const;

  constructor() {
    this.logger = new Logger();
    this.logger.info('Initializing MercadoPago MCP Server');

    this.authService = new AuthService(this.logger);

    this.server = new Server(
      {
        name: 'mercadopago',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {}
        },
      }
    );

    this.api = axios.create({
      baseURL: 'https://api.mercadopago.com/developers',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    this.setupAxiosInterceptors();
    this.setupToolHandlers();
  }

  private setupAxiosInterceptors() {
    // Auth interceptor
    this.api.interceptors.request.use(async (config) => {
      const token = await this.authService.getAccessToken();
      config.headers.Authorization = `Bearer ${token}`;
      return config;
    });

    // Request logging
    this.api.interceptors.request.use((config) => {
      this.logger.debug('API Request', {
        method: config.method,
        url: config.url,
        params: config.params,
        data: config.data,
      });
      return config;
    });

    // Response logging and error handling
    this.api.interceptors.response.use(
      (response) => {
        this.logger.debug('API Response', {
          status: response.status,
          url: response.config.url,
          data: response.data,
        });
        return response;
      },
      async (error: AxiosError) => {
        this.logger.error('API Error', {
          url: error.config?.url,
          method: error.config?.method,
          status: error.response?.status,
          data: error.response?.data,
          message: error.message,
        });

        // If auth error, clear token and retry once
        if (error.response?.status === 401 && error.config) {
          const config = error.config as InternalAxiosRequestConfig;
          if (!config.__isRetry) {
            this.logger.debug('Auth token expired, retrying request');
            this.authService.clearToken();
            config.__isRetry = true;
            return this.api(config);
          }
        }

        throw error;
      }
    );
  }

  private createRequestContext(toolName: string): RequestContext {
    this.requestCount++;
    return {
      toolName,
      requestId: `req_${this.requestCount}`,
      startTime: Date.now(),
    };
  }

  private logRequestEnd(context: RequestContext) {
    const duration = Date.now() - context.startTime;
    this.logger.debug('Tool execution completed', {
      ...context,
      duration: `${duration}ms`,
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'search_documentation',
              description: 'Search Mercado Pago documentation',
              inputSchema: {
                type: 'object',
                properties: {
                  language: {
                    type: 'string',
                    enum: ['es', 'pt'],
                    description: 'Language of the documentation (es: Spanish, pt: Portuguese)'
                  },
                  query: {
                    type: 'string',
                    description: 'Search query'
                  },
                  siteId: {
                    type: 'string',
                    description: 'Site ID for documentation',
                    enum: ['MLB', 'MLM', 'MLA', 'MLU', 'MLC', 'MCO', 'MPE']
                  },
                  limit: {
                    type: 'number',
                    description: 'Maximum number of results to return (default: 10)',
                    minimum: 1,
                    maximum: 100
                  }
                },
                required: ['language', 'query', 'siteId']
          }
        }
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const context = this.createRequestContext(request.params.name);
      this.logger.info('Tool invoked', { context, args: request.params.arguments });

      try {
        if (request.params.name === 'search_documentation') {
          if (this.isSearchDocumentationArgs(request.params.arguments)) {
            const result = await this.handleSearchDocumentation(request.params.arguments, context);
            this.logRequestEnd(context);
            return result;
          }
          throw new McpError(ErrorCode.InvalidParams, 'Invalid search_documentation arguments');
        }

        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${request.params.name}`
        );
      } catch (error) {
        this.logger.error('Tool execution failed', {
          context,
          error: error instanceof Error ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
          } : error,
        });

        if (axios.isAxiosError(error)) {
          return {
            content: [
              {
                type: 'text',
                text: `MercadoPago API error: ${
                  error.response?.data?.message || error.message
                }`,
              },
            ],
            isError: true,
          };
        }
        throw error;
      }
    });
  }

  private isSearchDocumentationArgs(args: unknown): args is SearchDocumentationArgs {
    if (!args || typeof args !== 'object') return false;
    const a = args as any;
    const validLanguage = (a.language && ['es', 'pt'].includes(a.language as Language));
    const validQuery = typeof a.query === 'string';
    const validSiteId = (a.siteId && DemoMercadoPagoServer.VALID_SITES.includes(a.siteId as SiteId));
    const validLimit = a.limit === undefined || (typeof a.limit === 'number' && a.limit >= 1 && a.limit <= 100);
    return validLanguage && validQuery && validSiteId && validLimit;
  }

  private async handleSearchDocumentation(args: SearchDocumentationArgs, context: RequestContext) {
    try {
      const response = await this.api.get<SearchResult[]>(
        '/docs/v1/search',
        {
          params: {
            term: args.query,
            lang: args.language,
            siteId: args.siteId,
            maxResults: args.limit || 10
          }
        }
      );

      const results = response.data;
      if (!results || !Array.isArray(results)) {
        throw new McpError(
          ErrorCode.InternalError,
          'No search results available for the given query'
        );
      }

      if (results.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No documentation found for query "${args.query}". Try a different search term.`
            }
          ]
        };
      }

      // Format results as markdown
      const markdown = results.map(result => {
        if (!result.title && !result.content) {
          this.logger.debug('Incomplete search result', { result });
          return null;  // Skip invalid results
        }

        const title = result.title || 'Untitled';
        const content = result.content || 'No description available';
        const siteDomain = DemoMercadoPagoServer.SITE_DOMAINS[args.siteId];
        const url = this.buildDocumentationUrl(siteDomain, args.language, result.url || '');
        const score = result.score || 0;

        return `## ${title}
${content}

🔗 [Read more](${url})

Score: ${score}
`;
      }).join('\n\n---\n\n');

      const formattedResults = `# Search Results for "${args.query}"
Showing ${results.length} results

${results.length > 0 ? markdown : 'No results found.'}`;

      return {
        content: [
          {
            type: 'text',
            text: formattedResults
          }
        ]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      return {
        content: [
          {
            type: 'text',
            text: `Error searching documentation: ${errorMessage}`
          }
        ],
        isError: true
      };
    }
  }

  async run() {
    try {
      this.logger.info('Starting MercadoPago MCP server');
      const transport = new StdioServerTransport();
      this.logger.debug('Connecting to stdio transport');
      await this.server.connect(transport);
      this.logger.info('Server running and ready');
    } catch (error) {
      this.logger.error('Failed to start server', {
        error: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: error.stack,
        } : error,
      });
      throw error;
    }
  }
}

// Initialize and run server with error handling
process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught exception', { error });
  process.exit(1);
});

process.on('unhandledRejection', (reason: any) => {
  logger.error('Unhandled rejection', { reason });
  process.exit(1);
});

const server = new DemoMercadoPagoServer();
server.run().catch((error: Error) => {
  logger.error('Server failed to start', { error });
  process.exit(1);
});
