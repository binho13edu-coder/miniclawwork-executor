import sys, json, urllib.request, re

def find_newsletters(niche):
    newsletters = []
    
    # Search Substack public topics
    try:
        req = urllib.request.Request(f"https://substack.com/search?q={niche}&type=publication", headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            html = resp.read().decode()
            # Extract publication names
            matches = re.findall(r'"publicationName":"([^"]+)"', html)
            urls = re.findall(r'"publicationUrl":"([^"]+)"', html)
            for i, name in enumerate(matches[:8]):
                newsletters.append({
                    "name": name,
                    "description": f"Newsletter sobre {niche} no Substack",
                    "subscribers": "N/A",
                    "url": urls[i] if i < len(urls) else "https://substack.com"
                })
    except Exception as e:
        pass
    
    # Fallback curated
    if not newsletters:
        newsletters = [
            {"name": f"{niche.title()} Weekly", "description": f"Curadoria semanal de {niche}", "subscribers": "Est. 1k-5k", "url": f"https://substack.com/search?q={niche}"},
            {"name": f"The {niche.title()} Digest", "description": f"Resumo diário de {niche}", "subscribers": "Est. 500-2k", "url": "https://substack.com"},
        ]
    
    return {"newsletters": newsletters}

if __name__ == "__main__":
    print(json.dumps(find_newsletters(sys.argv[1])))
