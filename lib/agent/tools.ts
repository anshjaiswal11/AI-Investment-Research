import { tool } from "@langchain/core/tools";
import { z } from "zod";

const TAVILY_API_KEY = process.env.TAVILY_API_KEY!;
const ALPHA_VANTAGE_API_KEY = process.env.ALPHA_VANTAGE_API_KEY!;

// ─── Tavily Web Search Tool ───────────────────────────────────────────────────
export const searchWeb = tool(
  async ({ query, maxResults = 5 }: { query: string; maxResults?: number }) => {
    try {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TAVILY_API_KEY}`,
        },
        body: JSON.stringify({
          query,
          max_results: maxResults,
          include_answer: true,
          include_raw_content: false,
          search_depth: "advanced",
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        return `Search failed: ${err}`;
      }

      const data = await response.json();
      const results = data.results || [];

      let output = data.answer ? `Summary: ${data.answer}\n\n` : "";
      output += results
        .slice(0, maxResults)
        .map(
          (r: { title: string; url: string; content: string }) =>
            `Title: ${r.title}\nURL: ${r.url}\nContent: ${r.content.slice(0, 400)}`
        )
        .join("\n\n---\n\n");

      return output || "No results found.";
    } catch (err) {
      return `Search error: ${String(err)}`;
    }
  },
  {
    name: "search_web",
    description:
      "Search the web for information about companies, financial news, and market data. Use for news, competitive analysis, management info, and qualitative research.",
    schema: z.object({
      query: z.string().describe("The search query"),
      maxResults: z
        .number()
        .optional()
        .default(5)
        .describe("Maximum number of results"),
    }),
  }
);

// ─── Alpha Vantage: Company Overview ─────────────────────────────────────────
export const getCompanyOverview = tool(
  async ({ ticker }: { ticker: string }) => {
    try {
      const url = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${ticker.toUpperCase()}&apikey=${ALPHA_VANTAGE_API_KEY}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      const data = await response.json();

      if (data.Note || data.Information) {
        return `API limit reached: ${data.Note || data.Information}`;
      }

      if (!data.Symbol) {
        return `No data found for ticker: ${ticker}`;
      }

      return JSON.stringify({
        Symbol: data.Symbol,
        Name: data.Name,
        Description: data.Description?.slice(0, 500),
        Exchange: data.Exchange,
        Currency: data.Currency,
        Country: data.Country,
        Sector: data.Sector,
        Industry: data.Industry,
        MarketCapitalization: data.MarketCapitalization,
        EBITDA: data.EBITDA,
        PERatio: data.PERatio,
        PEGRatio: data.PEGRatio,
        BookValue: data.BookValue,
        DividendPerShare: data.DividendPerShare,
        DividendYield: data.DividendYield,
        EPS: data.EPS,
        RevenuePerShareTTM: data.RevenuePerShareTTM,
        ProfitMargin: data.ProfitMargin,
        OperatingMarginTTM: data.OperatingMarginTTM,
        ReturnOnAssetsTTM: data.ReturnOnAssetsTTM,
        ReturnOnEquityTTM: data.ReturnOnEquityTTM,
        RevenueTTM: data.RevenueTTM,
        GrossProfitTTM: data.GrossProfitTTM,
        DilutedEPSTTM: data.DilutedEPSTTM,
        QuarterlyEarningsGrowthYOY: data.QuarterlyEarningsGrowthYOY,
        QuarterlyRevenueGrowthYOY: data.QuarterlyRevenueGrowthYOY,
        AnalystTargetPrice: data.AnalystTargetPrice,
        TrailingPE: data.TrailingPE,
        ForwardPE: data.ForwardPE,
        PriceToSalesRatioTTM: data.PriceToSalesRatioTTM,
        PriceToBookRatio: data.PriceToBookRatio,
        EVToRevenue: data.EVToRevenue,
        EVToEBITDA: data.EVToEBITDA,
        Beta: data.Beta,
        "52WeekHigh": data["52WeekHigh"],
        "52WeekLow": data["52WeekLow"],
        "50DayMovingAverage": data["50DayMovingAverage"],
        "200DayMovingAverage": data["200DayMovingAverage"],
        SharesOutstanding: data.SharesOutstanding,
        FullTimeEmployees: data.FullTimeEmployees,
        FiscalYearEnd: data.FiscalYearEnd,
        LatestQuarter: data.LatestQuarter,
        DebtToEquityRatio: data.DebtToEquityRatio,
        CurrentRatio: data.CurrentRatio,
        GrossProfit: data.GrossProfit,
      });
    } catch (err) {
      return `Error fetching company overview: ${String(err)}`;
    }
  },
  {
    name: "get_company_overview",
    description:
      "Get comprehensive financial overview for a stock ticker including P/E ratio, margins, growth rates, valuation metrics, and key financial ratios from Alpha Vantage.",
    schema: z.object({
      ticker: z
        .string()
        .describe(
          "Stock ticker symbol (e.g., AAPL, MSFT, TSLA). Use US exchange tickers."
        ),
    }),
  }
);

// ─── Alpha Vantage: Global Quote (current price) ──────────────────────────────
export const getStockQuote = tool(
  async ({ ticker }: { ticker: string }) => {
    try {
      const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${ticker.toUpperCase()}&apikey=${ALPHA_VANTAGE_API_KEY}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      const data = await response.json();

      if (data.Note || data.Information) {
        return `API limit reached.`;
      }

      const quote = data["Global Quote"];
      if (!quote || !quote["05. price"]) {
        return `No quote data for ticker: ${ticker}`;
      }

      return JSON.stringify({
        ticker: quote["01. symbol"],
        price: parseFloat(quote["05. price"]).toFixed(2),
        open: quote["02. open"],
        high: quote["03. high"],
        low: quote["04. low"],
        volume: quote["06. volume"],
        latestDay: quote["07. latest trading day"],
        previousClose: quote["08. previous close"],
        change: quote["09. change"],
        changePercent: quote["10. change percent"],
      });
    } catch (err) {
      return `Error fetching stock quote: ${String(err)}`;
    }
  },
  {
    name: "get_stock_quote",
    description:
      "Get the current stock price and daily trading data for a ticker symbol.",
    schema: z.object({
      ticker: z.string().describe("Stock ticker symbol (e.g., AAPL, MSFT)"),
    }),
  }
);

export const allTools = [searchWeb, getCompanyOverview, getStockQuote];
