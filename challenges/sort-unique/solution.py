n = int(input())
nums = list(map(int, input().split()))
print(*sorted(set(nums)))
