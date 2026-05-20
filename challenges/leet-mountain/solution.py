size, target = map(int, input().split())
numbers = input().split()
numbers = list(map(int, numbers))

d = dict()

for i, v in enumerate(numbers):
    complement = target - v
    if complement in d:
        print(d[complement], i)
        break
    d[v] = i