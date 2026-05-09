import sys
input = sys.stdin.readline

n = int(input())
nums = list(map(int, input().split()))
print('\n'.join(map(str, sorted(nums, reverse=True))))
