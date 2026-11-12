# Lede reference: edge tones
An edge or sequence message may end with ` | ` and a tone, so an allowed path reads green and a denied one red.
```
diagram net dir=LR title="Who may reach the database"
net: api "Orders API" svc
net: db "Orders DB" db
net: admin "Laptop" user
net: api -> db : allow | good
net: admin -x- db : deny | bad
net: legend
```
Tones: `good`, `bad`, `warn`, `info`, `neutral`. The arrow style still carries the meaning (`-x-` blocked, `-->` dashed),
so tone what matters and leave the rest plain. Labels are printed as written: keep them short and in lower case.
<!-- teaches: edge tones -->
