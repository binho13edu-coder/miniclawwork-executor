const axios = require('axios');
const CIDS={BTC:'bitcoin',ETH:'ethereum',BNB:'binancecoin',SOL:'solana',ADA:'cardano',XRP:'ripple'};
const cid=(a)=>CIDS[a.toUpperCase()]||a.toLowerCase();

const getCripto=async(ctx,ativo,runPy)=>{
  const id=ativo.toUpperCase(),c=cid(ativo);
  const py=[
    'import requests',
    `r=requests.get("https://api.coingecko.com/api/v3/simple/price?ids=${c}&vs_currencies=brl,usd&include_24hr_change=true",timeout=8)`,
    `d=r.json()["${c}"]`,
    'brl=f"{d[\'brl\']:,.2f}".replace(",","X").replace(".",",").replace("X",".")',
    'chg=round(d[\'brl_24h_change\'],2)',
    `print(f"${id}: R$ {brl} / USD {d['usd']:,.2f} | 24h: {chg}%")`
  ].join('\n');
  await runPy(ctx,py,`${id}...`,'');
};

const analiseCripto=async(ctx,ativo,runPy)=>{
  const id=ativo.toUpperCase(),c=cid(ativo);
  const py=[
    'import requests',
    `r=requests.get("https://api.coingecko.com/api/v3/coins/${c}/market_chart?vs_currency=brl&days=30",timeout=10)`,
    'prices=[p[1] for p in r.json()["prices"]]',
    'def sma(d,n): return sum(d[-n:])/n if len(d)>=n else None',
    'def rsi(d,n=14):',
    '    g,l=[],[]',
    '    for i in range(1,len(d)): x=d[i]-d[i-1]; g.append(max(x,0)); l.append(max(-x,0))',
    '    ag=sum(g[-n:])/n; al=sum(l[-n:])/n',
    '    return 100 if al==0 else round(100-100/(1+ag/al),1)',
    'ma7=sma(prices,7);ma21=sma(prices,21);rv=rsi(prices);p=prices[-1]',
    'tend="ALTA" if ma7 and ma21 and ma7>ma21 else "BAIXA"',
    'sig="SOBREVENDIDO" if rv<30 else("SOBRECOMPRADO" if rv>70 else "NEUTRO")',
    'def fmt(v): return f"{v:,.2f}".replace(",","X").replace(".",",").replace("X",".") if v else "N/A"',
    `print(f"${id} 30d | R$ {fmt(p)} | MA7:{fmt(ma7)} | MA21:{fmt(ma21)} | RSI:{rv} | {tend} | {sig}")`
  ].join('\n');
  await runPy(ctx,py,`Analisando ${id}...`,'');
};

const dominanciaCripto=async(ctx,runPy)=>{
  const py=[
    'import requests',
    'g=requests.get("https://api.coingecko.com/api/v3/global",timeout=8).json()["data"]',
    'fg=requests.get("https://api.alternative.me/fng/",timeout=8).json()["data"][0]',
    'print(f\'BTC Dom: {g["market_cap_percentage"]["btc"]:.1f}% | ETH: {g["market_cap_percentage"]["eth"]:.1f}% | F&G: {fg["value"]} ({fg["value_classification"]})\')'
  ].join('\n');
  await runPy(ctx,py,'Dominancia...','');
};

const criarAlerta=(alertas,nextId,ctx,m)=>{
  const ativo=m[1].toUpperCase(),op=m[2];
  const val=parseFloat(m[3].replace(/\./g,'').replace(',','.'));
  const id=nextId();
  alertas.push({id,ativo,operador:op,valor:val,chatId:ctx.chat.id});
  return id;
};

const verificarAlertas=async(alertas,bot)=>{
  if(!alertas.length)return;
  for(const a of[...alertas]){
    try{
      const c=CIDS[a.ativo]||a.ativo.toLowerCase();
      const r=await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${c}&vs_currencies=brl`,{timeout:6000});
      const preco=r.data[c]?.brl;
      if(!preco)continue;
      if(a.operador==='<'?preco<a.valor:preco>a.valor){
        await bot.telegram.sendMessage(a.chatId,`🔔 ALERTA: ${a.ativo} ${a.operador} R$${a.valor.toLocaleString('pt-BR')}\nAtual: R$${preco.toLocaleString('pt-BR')}`);
        const idx=alertas.findIndex(x=>x.id===a.id);
        if(idx!==-1)alertas.splice(idx,1);
      }
    }catch(e){console.log('[alerta fail]',e.message);}
  }
};

module.exports={getCripto,analiseCripto,dominanciaCripto,criarAlerta,verificarAlertas};
