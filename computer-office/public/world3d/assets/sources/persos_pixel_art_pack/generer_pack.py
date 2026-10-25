#!/usr/bin/env python3
"""Générateur procédural du pack pixel art. Dépendance : Pillow."""
from pathlib import Path
from PIL import Image, ImageDraw
import random, shutil

BASE = Path("persos_pixel_art_pack")
if BASE.exists(): shutil.rmtree(BASE)
BASE.mkdir(parents=True, exist_ok=True)
OUTLINE=(38,39,48,255); SKIN=(238,190,150,255); SKIN2=(190,125,91,255); WHITE=(244,241,225,255); SHADOW=(60,67,80,255)
def sprite(name,palette,direction,state,variant=0):
    img=Image.new("RGBA",(64,64),(0,0,0,0)); d=ImageDraw.Draw(img); hair,coat,accent,pants,shoes=palette
    frame={"statique":0,"marche":1,"course":2}[state]; stride=(0,2,4)[frame]; bob=(0,-1,-2)[frame]
    face={"haut":"back","droite":"right","gauche":"left","bas":"front"}[direction]; cx=32+(1 if face=="right" else -1 if face=="left" else 0)
    d.ellipse((cx-11,53,cx+11,58),fill=(45,50,58,90))
    if frame==0:
        d.rectangle((cx-7,42+bob,cx-2,51+bob),fill=pants); d.rectangle((cx+2,42+bob,cx+7,51+bob),fill=pants)
    else:
        d.rectangle((cx-8-stride//2,41+bob,cx-3-stride//2,50+bob),fill=pants); d.rectangle((cx+3+stride//2,41+bob,cx+8+stride//2,50+bob),fill=pants)
    d.rectangle((cx-9-stride//2,49+bob,cx-2-stride//2,53+bob),fill=OUTLINE); d.rectangle((cx+2+stride//2,49+bob,cx+9+stride//2,53+bob),fill=OUTLINE)
    d.rectangle((cx-8-stride//2,50+bob,cx-3-stride//2,52+bob),fill=shoes); d.rectangle((cx+3+stride//2,50+bob,cx+8+stride//2,52+bob),fill=shoes)
    d.rectangle((cx-10,28+bob,cx+10,43+bob),fill=OUTLINE); d.rectangle((cx-8,29+bob,cx+8,41+bob),fill=coat); d.rectangle((cx-2,30+bob,cx+2,40+bob),fill=accent)
    d.rectangle((cx-11,31+bob,cx-8,39+bob),fill=coat); d.rectangle((cx+8,31+bob,cx+11,39+bob),fill=coat)
    d.rectangle((cx-3,25+bob,cx+3,30+bob),fill=SKIN2); d.rectangle((cx-9,11+bob,cx+9,26+bob),fill=OUTLINE); d.rectangle((cx-7,13+bob,cx+7,24+bob),fill=SKIN)
    d.rectangle((cx-8,16+bob,cx-7,20+bob),fill=SKIN2); d.rectangle((cx+7,16+bob,cx+8,20+bob),fill=SKIN2)
    d.rectangle((cx-9,10+bob,cx+9,16+bob),fill=OUTLINE); d.rectangle((cx-7,8+bob,cx+7,14+bob),fill=hair); d.rectangle((cx-9,12+bob,cx-5,18+bob),fill=hair); d.rectangle((cx+5,12+bob,cx+9,18+bob),fill=hair)
    if variant%3==0: d.rectangle((cx-6,7+bob,cx-2,10+bob),fill=hair); d.rectangle((cx+1,6+bob,cx+5,10+bob),fill=hair)
    elif variant%3==1: d.rectangle((cx-8,8+bob,cx-3,12+bob),fill=hair); d.rectangle((cx+2,7+bob,cx+8,11+bob),fill=hair)
    else: d.rectangle((cx-5,6+bob,cx+4,10+bob),fill=hair)
    if face=="front": d.rectangle((cx-5,17+bob,cx-3,19+bob),fill=OUTLINE); d.rectangle((cx+3,17+bob,cx+5,19+bob),fill=OUTLINE); d.rectangle((cx-2,21+bob,cx+2,22+bob),fill=(156,76,72,255))
    elif face in ("left","right"):
        ex=cx-4 if face=="left" else cx+3; d.rectangle((ex,17+bob,ex+2,19+bob),fill=OUTLINE)
    low=name.lower()
    if low in ("red","gold"):
        d.rectangle((cx-10,7+bob,cx+10,11+bob),fill=OUTLINE); d.rectangle((cx-8,6+bob,cx+8,9+bob),fill=accent); d.rectangle((cx+2,9+bob,cx+11,10+bob),fill=WHITE)
    elif low=="peter":
        d.rectangle((cx-10,7+bob,cx+9,10+bob),fill=OUTLINE); d.rectangle((cx-8,5+bob,cx+7,8+bob),fill=hair)
    elif low=="cynthia":
        d.rectangle((cx-11,8+bob,cx+11,12+bob),fill=OUTLINE); d.rectangle((cx-9,6+bob,cx+9,10+bob),fill=hair)
    if face=="back": d.rectangle((cx-7,14+bob,cx+7,24+bob),fill=hair); d.rectangle((cx-5,25+bob,cx+5,28+bob),fill=hair)
    if "scientifique" in low: d.rectangle((cx-8,30+bob,cx+8,40+bob),fill=WHITE); d.rectangle((cx-2,31+bob,cx+2,39+bob),fill=accent)
    if "securite" in low: d.rectangle((cx-8,29+bob,cx+8,34+bob),fill=SHADOW)
    return img
main={"pierre_rochard":((105,112,126,255),(45,58,80,255),(160,187,205,255),(45,48,63,255),(25,29,37,255)),"peter":((224,126,43,255),(49,49,65,255),(230,197,78,255),(49,45,56,255),(35,31,40,255)),"gold":((45,40,31,255),(49,87,143,255),(239,187,48,255),(46,52,70,255),(27,31,42,255)),"red":((55,43,38,255),(202,65,57,255),(238,238,226,255),(45,50,63,255),(27,30,37,255)),"cynthia":((235,204,126,255),(61,65,91,255),(222,197,80,255),(48,47,65,255),(31,29,41,255))}
npc={"scientifique":((224,224,220,255),(230,231,223,255),(89,159,191,255),(90,100,113,255),(43,48,59,255)),"ingenieur":((87,69,48,255),(194,144,54,255),(255,219,103,255),(64,72,81,255),(34,39,45,255)),"analyste":((83,57,42,255),(67,92,113,255),(125,191,194,255),(53,60,72,255),(31,36,44,255)),"operateur":((76,61,46,255),(70,105,61,255),(183,190,104,255),(55,65,53,255),(31,37,31,255)),"securite":((38,40,49,255),(46,51,64,255),(219,170,61,255),(39,43,54,255),(22,25,31,255)),"livreur":((95,56,46,255),(176,59,54,255),(236,210,174,255),(52,63,76,255),(29,33,41,255)),"etudiant":((101,73,47,255),(55,104,165,255),(226,194,92,255),(52,61,81,255),(30,35,45,255)),"medecin":((220,158,162,255),(235,237,231,255),(193,80,93,255),(97,106,114,255),(43,48,56,255))}
for group,chars in [("principaux",main),("pnj",npc)]:
 for i,(name,pal) in enumerate(chars.items()):
  for direction in ("droite","gauche","haut","bas"):
   folder=BASE/group/name/direction; folder.mkdir(parents=True,exist_ok=True)
   for state in ("statique","marche","course"): sprite(name,pal,direction,state,i).save(folder/(state+".png"))
print("Pack de sprites généré dans",BASE.resolve())
