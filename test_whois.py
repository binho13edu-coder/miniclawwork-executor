import requests

def get_age(dom):
    try:
        r = requests.get(f"https://whois.iana.org/whois?q={dom}", timeout=5)
        print(r.text)
    except Exception as e:
        print(e)

get_age("google.com")
