#!/usr/bin/env python3
# coding: utf-8
import argparse, json, random, re
from typing import List

# ---- phonetic/ASR-ish replacements (extend as you wish) ----
PHONETIC_SUBS = [
    # English/Banglish
    (r"chicken", ["chikn","chiken","chikin","chkn"]),
    (r"pizza", ["piza","pija","pi za","pzza","pissa"]),
    (r"burger", ["borger","burgar","brgr"]),
    (r"give me", ["gimme","giv me","givmi","gi me"]),
    (r"please", ["pls","plz","pleasee"]),
    (r"spicy", ["spisi","spicyy","spyci"]),
    (r"one", ["1","wan","wun","ekta"]),
    # Bangla
    (r"অর্ডার", ["অরডার","অর ডার","অর্ডা","অরডাব"]),
    (r"পিজা", ["পিজ্জা","পিজা ","পিজা-টা","পিজাা"]),
    (r"চিকেন", ["চিকন","চিকেন্ন","চিকেনটা"]),
]

# Simple token noise
ADJ = {"a":"qs","b":"vn","c":"xv","d":"sf","e":"wr","f":"dg","g":"fh","h":"gj","i":"uo","j":"hk","k":"jl","l":"k","m":"nj","n":"bm","o":"ip","p":"o","q":"wa","r":"et","s":"ad","t":"ry","u":"iy","v":"cb","w":"qe","x":"zc","y":"tu","z":"x"}
VOWELS = set("aeiou")
SPLIT = re.compile(r"(\s+)")

def drop_vowel(tok:str)->str:
    idx=[i for i,ch in enumerate(tok) if ch.lower() in VOWELS]
    return tok if not idx else tok[:idx[0]]+tok[idx[0]+1:]

def kb_adj(tok:str)->str:
    if not tok: return tok
    i=random.randrange(len(tok))
    ch=tok[i]; repl=ADJ.get(ch.lower())
    if not repl: return tok
    r=random.choice(repl); r=r.upper() if ch.isupper() else r
    return tok[:i]+r+tok[i+1:]

def dup_letter(tok:str)->str:
    if len(tok)<2: return tok
    i=random.randrange(1,len(tok))
    return tok[:i]+tok[i]+tok[i:]

def space_break(tok:str)->str:
    if len(tok)<4: return tok
    i=random.randrange(1,len(tok)-1)
    return tok[:i]+" "+tok[i:]

def apply_phonetics(text:str)->str:
    out=text
    for pat,alts in PHONETIC_SUBS:
        if random.random()<0.8:
            out=re.sub(pat, lambda m: random.choice(alts), out, flags=re.IGNORECASE)
    return out

def perturb(text:str)->str:
    parts=SPLIT.split(text)
    idx=[i for i,p in enumerate(parts) if p and not p.isspace()]
    random.shuffle(idx); idx=idx[:random.randint(1,3)]
    for i in idx:
        tok=parts[i]
        ops=[drop_vowel, kb_adj, dup_letter]
        if len(tok)>=5: ops.append(space_break)
        parts[i]=random.choice(ops)(tok)
    return "".join(parts)

def make_noisy_variants(clean:str,k:int)->List[str]:
    out=[]
    for _ in range(k):
        x=apply_phonetics(clean)
        x=perturb(x)
        out.append(x)
    # dedupe
    seen=set(); uniq=[]
    for v in out:
        key=v.strip().lower()
        if key not in seen:
            seen.add(key); uniq.append(v)
    return uniq

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--in",dest="inp",required=True)
    ap.add_argument("--out",dest="outp",required=True)
    ap.add_argument("--per",dest="per",type=int,default=6)
    ap.add_argument("--seed",dest="seed",type=int,default=42)
    args=ap.parse_args()
    random.seed(args.seed)

    total_in=total_out=0
    with open(args.inp,"r",encoding="utf-8") as fin, open(args.outp,"w",encoding="utf-8") as fout:
        for line in fin:
            line=line.strip()
            if not line: continue
            obj=json.loads(line); total_in+=1
            msgs=obj.get("messages") or []
            if not msgs: continue

            # take last user msg
            user_full = ""
            for m in reversed(msgs):
                if m.get("role")=="user":
                    user_full = m.get("content","")
                    break
            if not user_full: continue

            # ---- keep [MenuHint] JSON untouched ----
            parts = user_full.split("\n\n[MenuHint]:", 1)
            text = parts[0].strip()
            hint = ("\n\n[MenuHint]:" + parts[1]) if len(parts)==2 else ""

            variants=make_noisy_variants(text, args.per)
            for v in variants:
                new_obj={
                    "messages":[
                        {"role":"system","content":"Return ONLY JSON"},
                        {"role":"user","content": (v + hint)}
                    ],
                    "response": obj.get("response", {})
                }
                fout.write(json.dumps(new_obj, ensure_ascii=False)+"\n")
                total_out+=1

    print(f"✅ {total_in} clean → {total_out} noisy lines at {args.outp}")

if __name__=="__main__":
    main()
