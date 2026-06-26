"use client";
import React from "react";

const TICKERS = [
  { symbol: "AAPL",  price: "189.30", change: "+1.2%",  pos: true  },
  { symbol: "MSFT",  price: "415.20", change: "+0.8%",  pos: true  },
  { symbol: "TSLA",  price: "248.90", change: "-2.1%",  pos: false },
  { symbol: "NVDA",  price: "875.40", change: "+3.4%",  pos: true  },
  { symbol: "AMZN",  price: "186.50", change: "+0.5%",  pos: true  },
  { symbol: "GOOGL", price: "173.20", change: "-0.3%",  pos: false },
  { symbol: "META",  price: "512.80", change: "+1.7%",  pos: true  },
  { symbol: "BRK.B", price: "392.10", change: "+0.2%",  pos: true  },
  { symbol: "JPM",   price: "198.70", change: "-0.6%",  pos: false },
  { symbol: "V",     price: "274.50", change: "+0.9%",  pos: true  },
];

export default function TickerTape() {
  const doubled = [...TICKERS, ...TICKERS];
  return (
    <div className="ticker-tape">
      <div className="ticker-inner">
        {doubled.map((t, i) => (
          <span key={i} className="ticker-item">
            <span className="ticker-symbol">{t.symbol}</span>
            <span className="ticker-price">${t.price}</span>
            <span className={`ticker-change ${t.pos ? "positive" : "negative"}`}>
              {t.change}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
