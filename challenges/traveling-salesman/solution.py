from itertools import permutations
import sys
input = sys.stdin.readline

n = int(input())
w = [list(map(int, input().split())) for _ in range(n)]

ans = float('inf')
for perm in permutations(range(1, n)):
    path = [0] + list(perm) + [0]
    cost = 0
    valid = True
    for i in range(len(path) - 1):
        if w[path[i]][path[i + 1]] == 0:
            valid = False
            break
        cost += w[path[i]][path[i + 1]]
    if valid:
        ans = min(ans, cost)
print(ans)
