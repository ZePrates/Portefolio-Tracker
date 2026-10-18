import React from 'react';
import { createRoot } from 'react-dom/client';
import { BenchmarkCard } from './components/benchmark-card';
const series = Array.from({length: 1000}, (_, i) => { const d = new Date(Date.UTC(2024, 0, 19+i)); return {date:d.toISOString().slice(0,10), invested:1000+i*5, benchmark:1100+i*6, portfolio:1200+i*7}; });
export function mount(){
 document.body.innerHTML='<main id="probe" style="max-width:1100px;margin:24px auto"></main>';
 const el=document.getElementById('probe'); if(!el)return;
 createRoot(el).render(<BenchmarkCard comparison={{annualReturnPct:10.56,portfolio:8193,portfolioValue:8193,dividends:0,benchmark:7094,invested:5995,difference:1099,differencePct:15.49,firstDate:series[0]?.date ?? '',series}} scope="total" onScopeChange={()=>{}} hidden={false}/>);
}
