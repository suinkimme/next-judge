n = int(input())
d = 2
while d * d <= n:
    if n % d == 0:
        cnt = 0
        while n % d == 0:
            cnt += 1
            n //= d
        print(d, cnt)
    d += 1
if n > 1:
    print(n, 1)
