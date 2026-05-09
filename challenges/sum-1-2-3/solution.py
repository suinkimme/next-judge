import sys
input = sys.stdin.readline

MAX = 10001
dp = [0] * MAX
dp[0] = 1
for coin in [1, 2, 3]:
    for j in range(coin, MAX):
        dp[j] += dp[j - coin]

t = int(input())
for _ in range(t):
    print(dp[int(input())])
