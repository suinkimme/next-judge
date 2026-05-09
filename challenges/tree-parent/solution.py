from collections import defaultdict, deque
import sys
input = sys.stdin.readline

n = int(input())
adj = defaultdict(list)
for _ in range(n - 1):
    u, v = map(int, input().split())
    adj[u].append(v)
    adj[v].append(u)

parent = [0] * (n + 1)
visited = [False] * (n + 1)
queue = deque([1])
visited[1] = True
while queue:
    node = queue.popleft()
    for nb in adj[node]:
        if not visited[nb]:
            visited[nb] = True
            parent[nb] = node
            queue.append(nb)

print('\n'.join(str(parent[i]) for i in range(2, n + 1)))
