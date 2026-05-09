n = int(input())
perm = list(map(int, input().split()))

i = n - 2
while i >= 0 and perm[i] <= perm[i + 1]:
    i -= 1

if i < 0:
    print(-1)
else:
    j = n - 1
    while perm[j] >= perm[i]:
        j -= 1
    perm[i], perm[j] = perm[j], perm[i]
    perm[i + 1:] = perm[i + 1:][::-1]
    print(*perm)
