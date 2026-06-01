import sys, json, urllib.request, ssl, socket

def recon(target):
    subdomains = []
    tech = []
    certs = []
    
    # Certificate transparency via crt.sh
    try:
        req = urllib.request.Request(f"https://crt.sh/?q=%.{target}&output=json", headers={"User-Agent": "MiniClawwork"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
            seen = set()
            for entry in data[:20]:
                name = entry.get("name_value", "").strip()
                if name and name not in seen:
                    seen.add(name)
                    subdomains.append(name)
    except Exception as e:
        pass
    
    # Tech stack via headers
    try:
        req = urllib.request.Request(f"https://{target}", headers={"User-Agent": "Mozilla/5.0"}, method='HEAD')
        with urllib.request.urlopen(req, timeout=10) as resp:
            headers = dict(resp.headers)
            server = headers.get('Server', '')
            if server: tech.append(server)
            powered = headers.get('X-Powered-By', '')
            if powered: tech.append(powered)
    except:
        pass
    
    # SSL cert info
    try:
        ctx = ssl.create_default_context()
        with socket.create_connection((target, 443), timeout=10) as sock:
            with ctx.wrap_socket(sock, server_hostname=target) as ssock:
                cert = ssock.getpeercert()
                certs.append(f"Issuer: {cert.get('issuer', 'N/A')}")
                certs.append(f"Expires: {cert.get('notAfter', 'N/A')}")
    except:
        pass
    
    return {"subdomains": subdomains[:15], "tech": tech, "certs": certs}

def owasp(target):
    checks = []
    # Check for common security headers
    try:
        req = urllib.request.Request(f"https://{target}", headers={"User-Agent": "Mozilla/5.0"}, method='HEAD')
        with urllib.request.urlopen(req, timeout=10) as resp:
            headers = dict(resp.headers)
            checks.append({"check": "HSTS", "found": "strict-transport-security" not in str(headers).lower(), "severity": "MEDIA"})
            checks.append({"check": "X-Frame-Options", "found": "x-frame-options" not in str(headers).lower(), "severity": "BAIXA"})
            checks.append({"check": "X-Content-Type-Options", "found": "x-content-type-options" not in str(headers).lower(), "severity": "BAIXA"})
            checks.append({"check": "CSP", "found": "content-security-policy" not in str(headers).lower(), "severity": "MEDIA"})
    except Exception as e:
        checks.append({"check": "Conectividade", "found": True, "severity": "ALTA"})
    
    return {"checks": checks}

def api_scan(target):
    endpoints = []
    auth_issues = []
    
    # Common API paths
    common_paths = ["/api", "/api/v1", "/api/v2", "/swagger.json", "/openapi.json", "/graphql"]
    for path in common_paths:
        try:
            req = urllib.request.Request(f"https://{target}{path}", headers={"User-Agent": "Mozilla/5.0"}, method='HEAD')
            with urllib.request.urlopen(req, timeout=5) as resp:
                if resp.status == 200:
                    endpoints.append(f"{path} (200)")
        except urllib.error.HTTPError as e:
            if e.code in [401, 403]:
                auth_issues.append(f"{path} requer auth ({e.code})")
            elif e.code == 200:
                endpoints.append(f"{path} (200)")
        except:
            pass
    
    return {"endpoints": endpoints, "auth_issues": auth_issues}

def report(target):
    r = recon(target)
    o = owasp(target)
    a = api_scan(target)
    
    findings = []
    cvss_sum = 0
    
    for c in o["checks"]:
        if c["found"]:
            sev = 8 if c["severity"] == "ALTA" else (5 if c["severity"] == "MEDIA" else 3)
            findings.append({"issue": c["check"], "severity": c["severity"], "cvss": sev})
            cvss_sum += sev
    
    cvss_avg = round(cvss_sum / max(len(findings), 1), 1)
    risk = "CRITICO" if cvss_avg > 7 else ("ALTO" if cvss_avg > 5 else ("MEDIO" if cvss_avg > 3 else "BAIXO"))
    
    return {
        "cvss_avg": cvss_avg,
        "findings": findings,
        "risk_level": risk,
        "recon_summary": f"{len(r['subdomains'])} subs, {len(r['tech'])} techs"
    }

if __name__ == "__main__":
    target = sys.argv[1]
    mode = sys.argv[2]
    if mode == "recon":
        print(json.dumps(recon(target)))
    elif mode == "owasp":
        print(json.dumps(owasp(target)))
    elif mode == "api":
        print(json.dumps(api_scan(target)))
    elif mode == "report":
        print(json.dumps(report(target)))
    else:
        print(json.dumps({"error": "Modo inválido"}))
