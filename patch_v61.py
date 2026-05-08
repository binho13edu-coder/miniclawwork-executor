import shutil
BASE="/home/opc/miniclawwork-executor"
INDEX=BASE+"/index.js"
shutil.copy(INDEX,INDEX+".backup_v6_pre")
print("[OK] backup")
c=open(INDEX).read()
if "cryptoSkill" not in c:
    c=c.replace("const fs = require('fs');","const fs = require('fs');\nconst cryptoSkill = require('./skills/crypto');",1)
    print("[OK] require adicionado")
else:
    print("[SKIP] require ja existe")
mc="// \u2500\u2500\u2500 Cripto"
ma="// \u2500\u2500\u2500 Alertas"
if mc in c and ma in c:
    s=c.index(mc); e=c.index(ma)
    nb="// \u2500\u2500\u2500 Cripto (v6.1 \u2013 skill modular) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nconst getCripto      = (ctx, ativo) => cryptoSkill.getCripto(ctx, ativo, triggerAndWait);\nconst analiseCripto  = (ctx, ativo) => cryptoSkill.analiseCripto(ctx, ativo, triggerAndWait);\nconst dominanciaCripto = (ctx)      => cryptoSkill.dominanciaCripto(ctx, triggerAndWait);\n\n"
    c=c[:s]+nb+c[e:]
    print("[OK] bloco cripto -> thin wrappers")
else:
    print("[WARN] marcadores nao encontrados")
vs=c.find("const verificarAlertas = async () => {")
si=c.find("setInterval(verificarAlertas",vs)
si=c.index(";",si)+1
if vs>0 and si>vs:
    nv="// \u2500\u2500\u2500 Alertas (v6.1 \u2013 skill modular) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nconst verificarAlertas = async () => cryptoSkill.verificarAlertas(alertas, bot);\nsetInterval(verificarAlertas, 2 * 60 * 1000);"
    c=c[:vs]+nv+c[si:]
    print("[OK] verificarAlertas delegada")
else:
    print("[FAIL] verificarAlertas nao encontrada")
c=c.replace("MiniClawwork v5.0","MiniClawwork v6.1")
print("[OK] v5.0 -> v6.1")
open(INDEX,"w").write(c)
print(f"[DONE] index.js: {c.count(chr(10))} linhas")
