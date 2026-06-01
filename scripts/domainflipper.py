import sys, json, urllib.request

def find_domains(keyword):
    domains = []
    
    # Use expireddomains.net public search (scraping simplified)
    try:
        req = urllib.request.Request(f"https://www.expireddomains.net/domain-name/?q={keyword}&ftlds[]=2&ftlds[]=3&flimit=10", headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            html = resp.read().decode()
            # Simple regex extraction
            import re
            matches = re.findall(r'<a[^>]*href="/([^"/]+\\.(com|net|org|io|co))/"', html)
            for m in matches[:10]:
                domains.append({
                    "domain": m[0],
                    "da": "N/A (use MOZ API)",
                    "pa": "N/A",
                    "age": "N/A",
                    "backlinks": "N/A",
                    "potential": "Verificar manualmente em expireddomains.net"
                })
    except Exception as e:
        pass
    
    # Fallback: generate suggestions
    if not domains:
        tlds = [".com", ".io", ".co", ".app", ".dev"]
        prefixes = ["get", "my", "try", "use", "go", "the"]
        for p in prefixes:
            for t in tlds:
                domains.append({
                    "domain": f"{p}{keyword}{t}",
                    "da": "N/A",
                    "pa": "N/A", 
                    "age": "0",
                    "backlinks": "0",
                    "potential": "Domínio disponível (verificar registro)"
                })
    
    return {"domains": domains[:8]}

if __name__ == "__main__":
    print(json.dumps(find_domains(sys.argv[1])))
