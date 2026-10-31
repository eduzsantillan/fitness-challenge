"""Render the code-native Ritmo mark without external dependencies."""
from pathlib import Path
import math, struct, zlib
root = Path(__file__).resolve().parents[1] / 'web/public/icons'
points = [(123,264),(188,264),(228,171),(289,340),(329,264),(389,264)]
def distance(x,y,a,b):
    dx,dy=b[0]-a[0],b[1]-a[1]
    t=max(0,min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy)))
    return math.hypot(x-a[0]-t*dx,y-a[1]-t*dy)
def chunk(name,data):
    return struct.pack('>I',len(data))+name+data+struct.pack('>I',zlib.crc32(name+data)&0xffffffff)
for size,name in [(192,'icon-192.png'),(512,'icon-512.png'),(180,'apple-touch-icon.png')]:
    rows=[]
    for y in range(size):
        row=bytearray([0])
        for x in range(size):
            d=min(distance((x+.5)*512/size,(y+.5)*512/size,a,b) for a,b in zip(points,points[1:]))
            coverage=max(0,min(1,(13-d)*size/512+.5))
            row.extend(round(c+(255-c)*coverage) for c in (231,117,76))
        rows.append(row)
    png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',size,size,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(rows)))+chunk(b'IEND',b'')
    (root/name).write_bytes(png)
